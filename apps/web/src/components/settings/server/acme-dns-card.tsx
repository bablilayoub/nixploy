"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { useSaveBar } from "@/components/services/save-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

const NONE = "none";

/**
 * ACME DNS-01 provider for **wildcard** certificates (`*.apps.example.com`).
 * HTTP-01 can only validate a concrete host, so a wildcard needs a provider
 * that can write a TXT record.
 *
 * Nixploy stores the credentials encrypted, but Traefik reads them from its
 * own process environment — the panel cannot inject them into a running
 * container, so the operator applies the printed `docker service update`
 * command once (see docs/domains-traefik.md).
 */
export function AcmeDnsCard() {
	const trpc = useTRPC();

	const settingsQuery = useQuery(trpc.webServer.getSettings.queryOptions());
	const providersQuery = useQuery(trpc.webServer.acmeDnsProviders.queryOptions());

	const providerDraft = useDraft<string>(settingsQuery.data?.acmeDnsProvider ?? NONE);
	const provider = providerDraft.value;
	// Write-only secrets: never seeded from the server, cleared after a save.
	const [credentials, setCredentials] = useState<Record<string, string>>({});

	const save = useSaveMutation(trpc.webServer.updateSettings.mutationOptions(), {
		successMessage: "DNS provider saved — Traefik reloads its static config",
		invalidate: [trpc.webServer.getSettings.queryKey()],
		onSuccess: () => {
			providerDraft.markSaved();
			setCredentials({});
		},
	});

	const providers = providersQuery.data ?? [];
	const selected = providers.find((entry) => entry.code === provider);
	const savedKeys = settingsQuery.data?.acmeDnsCredentialKeys ?? [];

	const onSave = () => {
		if (provider === NONE) {
			save.mutate({ acmeDnsProvider: null, acmeDnsCredentials: null });
			return;
		}
		const filled = Object.fromEntries(
			Object.entries(credentials).filter(([, value]) => value.trim() !== ""),
		);
		save.mutate({
			acmeDnsProvider: provider,
			// Leaving every field blank keeps the stored credentials.
			...(Object.keys(filled).length > 0 ? { acmeDnsCredentials: filled } : {}),
		});
	};

	useSaveBar(providerDraft, {
		onSave,
		pending: save.isPending,
		disabled: settingsQuery.isPending,
	});

	const envCommand =
		selected && selected.envKeys.length > 0
			? `docker service update ${selected.envKeys
					.map((key) => `--env-add ${key}=<value>`)
					.join(" ")} nixploy-traefik`
			: null;

	return (
		<SettingsSection
			id="wildcard-certificates"
			title="Wildcard certificates"
			description="DNS-01 challenge provider, required for *.example.com domains."
			actions={
				<Button
					type="button"
					size="sm"
					disabled={save.isPending || settingsQuery.isPending}
					onClick={onSave}
				>
					{save.isPending && <Loader2 className="size-4 animate-spin" />}
					Save provider
				</Button>
			}
		>
			{settingsQuery.isPending || providersQuery.isPending ? (
				<div className="grid gap-4">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : (
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="acme-dns-provider">DNS provider</Label>
						<Select value={provider} onValueChange={providerDraft.set}>
							<SelectTrigger id="acme-dns-provider">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NONE}>None (HTTP-01 only)</SelectItem>
								{providers.map((entry) => (
									<SelectItem key={entry.code} value={entry.code}>
										{entry.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Without a provider, wildcard domains can only use certificate type “None” or a custom
							certificate.
						</p>
					</div>

					{selected?.envKeys.map((key) => (
						<div key={key} className="grid gap-2">
							<Label htmlFor={`acme-dns-${key}`}>{key}</Label>
							<Input
								id={`acme-dns-${key}`}
								type="password"
								autoComplete="off"
								placeholder={savedKeys.includes(key) ? "•••••••• (saved)" : "Enter the value"}
								value={credentials[key] ?? ""}
								onChange={(event) =>
									setCredentials((current) => ({ ...current, [key]: event.target.value }))
								}
							/>
						</div>
					))}

					{envCommand && (
						<div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
							<p className="text-xs text-muted-foreground">
								Traefik reads provider credentials from its own environment. Run this once on the
								Nixploy host (values are the ones you entered above):
							</p>
							<code className="overflow-x-auto whitespace-pre font-mono text-xs">{envCommand}</code>
						</div>
					)}
				</div>
			)}
		</SettingsSection>
	);
}
