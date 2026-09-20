"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { useSaveBar } from "@/components/services/save-bar";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { describeError } from "@/lib/describe-error";
import { useTRPC, useTRPCClient } from "@/lib/trpc";

const NONE = "none";

/**
 * The DNS provider link: DNS-01 for **wildcard** certificates
 * (`*.apps.example.com` — HTTP-01 can only validate a concrete host), and,
 * for the providers with a record client in `modules/dns`, the A records
 * that point new domains at this server.
 *
 * Credentials are stored encrypted and pushed to the Traefik service on
 * save (`docker service update --env-add`, diffed first — a change restarts
 * the proxy for ~9 s). They are write-only here: the panel reports which
 * keys are set, never their values.
 */
export function AcmeDnsCard() {
	const trpc = useTRPC();
	const client = useTRPCClient();

	const settingsQuery = useQuery(trpc.webServer.getSettings.queryOptions());
	const providersQuery = useQuery(trpc.webServer.acmeDnsProviders.queryOptions());

	const providerDraft = useDraft<string>(settingsQuery.data?.acmeDnsProvider ?? NONE);
	const provider = providerDraft.value;
	const recordsDraft = useDraft<boolean>(settingsQuery.data?.dnsAutoRecords ?? false);
	// Write-only secrets: never seeded from the server, cleared after a save.
	const [credentials, setCredentials] = useState<Record<string, string>>({});
	const [zoneCheck, setZoneCheck] = useState<
		| { state: "idle" }
		| { state: "pending" }
		| { state: "ok"; zones: string[] }
		| { state: "error"; message: string }
	>({ state: "idle" });

	const save = useSaveMutation(trpc.webServer.updateSettings.mutationOptions(), {
		successMessage: "DNS provider saved",
		invalidate: [trpc.webServer.getSettings.queryKey()],
		onSuccess: () => {
			providerDraft.markSaved();
			recordsDraft.markSaved();
			setCredentials({});
			setZoneCheck({ state: "idle" });
		},
	});

	const providers = providersQuery.data ?? [];
	const selected = providers.find((entry) => entry.code === provider);
	const savedKeys = settingsQuery.data?.acmeDnsCredentialKeys ?? [];
	const recordsSupported = Boolean(selected?.records);

	const onSave = () => {
		if (provider === NONE) {
			save.mutate({ acmeDnsProvider: null, acmeDnsCredentials: null, dnsAutoRecords: false });
			return;
		}
		const filled = Object.fromEntries(
			Object.entries(credentials).filter(([, value]) => value.trim() !== ""),
		);
		save.mutate({
			acmeDnsProvider: provider,
			// Leaving every field blank keeps the stored credentials.
			...(Object.keys(filled).length > 0 ? { acmeDnsCredentials: filled } : {}),
			// The switch only means something for a provider with a record client.
			dnsAutoRecords: recordsSupported && recordsDraft.value,
		});
	};

	const combinedDraft = {
		dirty: providerDraft.dirty || recordsDraft.dirty,
		reset: () => {
			providerDraft.reset();
			recordsDraft.reset();
		},
	};
	useSaveBar(combinedDraft, {
		onSave,
		pending: save.isPending,
		disabled: settingsQuery.isPending,
	});

	// Asks the provider for its zones with the *stored* credentials — so it
	// runs against what was saved, which is why it is disabled while dirty.
	const checkLink = async () => {
		setZoneCheck({ state: "pending" });
		try {
			const result = await client.webServer.dnsZones.query();
			setZoneCheck({ state: "ok", zones: result.zones });
		} catch (error) {
			setZoneCheck({
				state: "error",
				message: describeError(error, "The provider did not answer"),
			});
		}
	};

	const linkSaved = settingsQuery.data?.acmeDnsProvider === provider && provider !== NONE;

	return (
		<SettingsSection
			id="wildcard-certificates"
			title="DNS provider"
			description="Wildcard certificates (DNS-01) and, where supported, DNS records created for new domains."
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
						<Label htmlFor="acme-dns-provider">Provider</Label>
						<Select value={provider} onValueChange={providerDraft.set}>
							<SelectTrigger id="acme-dns-provider">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NONE}>None (HTTP-01 only)</SelectItem>
								{providers.map((entry) => (
									<SelectItem key={entry.code} value={entry.code}>
										{entry.label}
										{entry.records ? "" : " (certificates only)"}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Without a provider, wildcard domains can only use certificate type “None” or a custom
							certificate. Credentials are pushed to Traefik when saved; a change restarts the proxy
							for a few seconds.
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

					{selected && (
						<div className="grid gap-3 rounded-lg border border-border p-3">
							<div className="flex items-start justify-between gap-4">
								<div className="grid gap-1">
									<Label htmlFor="dns-auto-records">Create DNS records automatically</Label>
									<p className="text-xs text-muted-foreground">
										{recordsSupported
											? "When a domain is attached — by hand or by a template — its A record is created in the matching zone at " +
												`${selected.label}, pointing at this server's public IPv4. Existing records that point elsewhere are updated; a round-robin set is left alone.`
											: `${selected.label} is used for certificates only: Nixploy has no record client for it yet. Create the A record at the provider yourself.`}
									</p>
								</div>
								<Switch
									id="dns-auto-records"
									checked={recordsSupported && recordsDraft.value}
									disabled={!recordsSupported}
									onCheckedChange={recordsDraft.set}
								/>
							</div>
							{recordsSupported && (
								<div className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={!linkSaved || combinedDraft.dirty || zoneCheck.state === "pending"}
										title={
											linkSaved && !combinedDraft.dirty
												? undefined
												: "Save the provider first — the check uses the stored credentials"
										}
										onClick={checkLink}
									>
										{zoneCheck.state === "pending" && <Loader2 className="size-4 animate-spin" />}
										Check link
									</Button>
									{zoneCheck.state === "ok" &&
										(zoneCheck.zones.length === 0 ? (
											<span className="text-xs text-muted-foreground">
												Linked, but the credentials see no zones.
											</span>
										) : (
											zoneCheck.zones.map((zone) => (
												<Badge key={zone} variant="secondary">
													{zone}
												</Badge>
											))
										))}
									{zoneCheck.state === "error" && (
										<span className="text-xs text-destructive">{zoneCheck.message}</span>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</SettingsSection>
	);
}
