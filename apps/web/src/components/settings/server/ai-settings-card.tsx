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
import { Switch } from "@/components/ui/switch";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

type Provider = "openai" | "anthropic" | "openai-compatible" | "ollama";

export function AiSettingsCard() {
	const trpc = useTRPC();
	const statusQuery = useQuery(trpc.ai.getSettings.queryOptions());

	const settings = statusQuery.data;
	const draft = useDraft({
		enabled: settings?.enabled ?? false,
		provider: settings?.provider ?? ("openai" as Provider),
		baseUrl: settings?.baseUrl ?? "",
		model: settings?.model ?? "gpt-4o-mini",
		autoExplain: settings?.autoExplainOnFailure ?? false,
	});
	const { enabled, provider, baseUrl, model, autoExplain } = draft.value;
	// Write-only secret: never seeded from the server, cleared after a save.
	const [apiKey, setApiKey] = useState("");

	const save = useSaveMutation(trpc.ai.updateSettings.mutationOptions(), {
		successMessage: "Copilot settings saved",
		invalidate: [trpc.ai.getSettings.queryKey()],
		onSuccess: () => {
			setApiKey("");
			draft.markSaved();
		},
	});

	const persist = (next?: { enabled?: boolean }) => {
		const nextEnabled = next?.enabled ?? enabled;
		save.mutate({
			enabled: nextEnabled,
			provider,
			baseUrl: baseUrl.trim() || null,
			model: model.trim(),
			apiKey: apiKey.trim() || null,
			autoExplainOnFailure: autoExplain,
		});
	};

	useSaveBar(draft, { onSave: () => persist(), pending: save.isPending });

	if (statusQuery.isPending) {
		return (
			<SettingsSection
				id="copilot"
				title="Deploy Copilot"
				description="Explain failed builds with an LLM. Keys stay encrypted."
			>
				<Skeleton className="h-10 w-full" />
			</SettingsSection>
		);
	}

	if (statusQuery.isError) {
		return (
			<SettingsSection
				id="copilot"
				title="Deploy Copilot"
				description="Explain failed builds with an LLM. Keys stay encrypted."
			>
				<div className="flex flex-col gap-2">
					<p className="text-sm text-muted-foreground">
						{statusQuery.error.message || "Could not load AI settings."}
					</p>
					<Button
						variant="outline"
						size="sm"
						className="w-fit"
						onClick={() => void statusQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			</SettingsSection>
		);
	}

	return (
		<SettingsSection
			id="copilot"
			title="Deploy Copilot"
			description="Explain failed builds with an LLM. Keys stay encrypted."
			actions={
				<div className="flex items-center gap-3">
					<span className="text-sm text-muted-foreground">{enabled ? "On" : "Off"}</span>
					<Switch
						id="ai-enabled"
						checked={enabled}
						disabled={save.isPending}
						onCheckedChange={(checked) => {
							draft.patch({ enabled: checked });
							save.mutate({
								enabled: checked,
								provider,
								baseUrl: baseUrl.trim() || null,
								model: model.trim(),
								apiKey: apiKey.trim() || null,
								autoExplainOnFailure: autoExplain,
							});
						}}
					/>
				</div>
			}
		>
			{enabled ? (
				<>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label>Provider</Label>
							<Select
								value={provider}
								onValueChange={(v) => draft.patch({ provider: v as Provider })}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="openai">OpenAI</SelectItem>
									<SelectItem value="anthropic">Anthropic</SelectItem>
									<SelectItem value="openai-compatible">OpenAI-compatible</SelectItem>
									<SelectItem value="ollama">Ollama</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="ai-model">Model</Label>
							<Input
								id="ai-model"
								value={model}
								onChange={(e) => draft.patch({ model: e.target.value })}
								placeholder="gpt-4o-mini"
							/>
						</div>
					</div>

					{(provider === "openai-compatible" || provider === "ollama") && (
						<div className="grid gap-2">
							<Label htmlFor="ai-base">Base URL</Label>
							<Input
								id="ai-base"
								value={baseUrl}
								onChange={(e) => draft.patch({ baseUrl: e.target.value })}
								placeholder={
									provider === "ollama" ? "http://127.0.0.1:11434/v1" : "https://api.example.com/v1"
								}
							/>
						</div>
					)}

					<div className="grid gap-2">
						<Label htmlFor="ai-key">
							API key
							{statusQuery.data?.apiKeyConfigured ? (
								<span className="ml-2 text-xs font-normal text-muted-foreground">(configured)</span>
							) : null}
						</Label>
						<Input
							id="ai-key"
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder={statusQuery.data?.apiKeyConfigured ? "Leave blank to keep" : "sk-…"}
							autoComplete="off"
						/>
					</div>

					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<Label htmlFor="ai-auto">Auto-explain failures</Label>
							<p className="text-xs text-muted-foreground">
								Analyze deploy logs when a build fails.
							</p>
						</div>
						<Switch
							id="ai-auto"
							checked={autoExplain}
							onCheckedChange={(checked) => draft.patch({ autoExplain: checked })}
						/>
					</div>

					<div className="flex flex-wrap gap-2">
						<Button type="button" size="sm" disabled={save.isPending} onClick={() => persist()}>
							{save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
							Save
						</Button>
						{statusQuery.data?.apiKeyConfigured && (
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={save.isPending}
								onClick={() => save.mutate({ clearApiKey: true })}
							>
								Clear API key
							</Button>
						)}
					</div>
				</>
			) : (
				<p className="text-sm text-muted-foreground">
					Turn on to configure a provider and API key.
				</p>
			)}
		</SettingsSection>
	);
}
