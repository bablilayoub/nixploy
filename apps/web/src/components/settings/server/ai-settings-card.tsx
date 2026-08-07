"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/settings/settings-section";
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
import { useTRPC } from "@/lib/trpc";

type Provider = "openai" | "anthropic" | "openai-compatible" | "ollama";

export function AiSettingsCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const statusQuery = useQuery(trpc.ai.getSettings.queryOptions());

	const [enabled, setEnabled] = useState(false);
	const [provider, setProvider] = useState<Provider>("openai");
	const [baseUrl, setBaseUrl] = useState("");
	const [model, setModel] = useState("gpt-4o-mini");
	const [apiKey, setApiKey] = useState("");
	const [autoExplain, setAutoExplain] = useState(false);

	useEffect(() => {
		if (!statusQuery.data) return;
		setEnabled(statusQuery.data.enabled);
		setProvider(statusQuery.data.provider);
		setBaseUrl(statusQuery.data.baseUrl ?? "");
		setModel(statusQuery.data.model);
		setAutoExplain(statusQuery.data.autoExplainOnFailure);
		setApiKey("");
	}, [statusQuery.data]);

	const save = useMutation({
		...trpc.ai.updateSettings.mutationOptions(),
		onSuccess: async () => {
			toast.success("Copilot settings saved");
			setApiKey("");
			await queryClient.invalidateQueries({ queryKey: trpc.ai.getSettings.queryKey() });
		},
		onError: (error) => toast.error(error.message),
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
							setEnabled(checked);
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
							<Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
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
								onChange={(e) => setModel(e.target.value)}
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
								onChange={(e) => setBaseUrl(e.target.value)}
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
						<Switch id="ai-auto" checked={autoExplain} onCheckedChange={setAutoExplain} />
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
