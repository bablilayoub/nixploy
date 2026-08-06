"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
			toast.success("AI Copilot settings saved");
			setApiKey("");
			await queryClient.invalidateQueries({ queryKey: trpc.ai.getSettings.queryKey() });
		},
		onError: (error) => toast.error(error.message),
	});

	if (statusQuery.isPending) {
		return (
			<Card>
				<CardHeader>
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-4 w-64" />
				</CardHeader>
				<CardContent>
					<Skeleton className="h-24 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (statusQuery.error) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Bot className="size-4" />
					Deploy Copilot
				</CardTitle>
				<CardDescription>
					Optional LLM that explains failed builds and answers questions about a service. Keys stay
					encrypted at rest.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-5">
				<div className="flex items-center justify-between gap-4">
					<div>
						<Label htmlFor="ai-enabled">Enable Copilot</Label>
						<p className="text-xs text-muted-foreground">Shows Explain on failed deployments</p>
					</div>
					<Switch id="ai-enabled" checked={enabled} onCheckedChange={setEnabled} />
				</div>

				<div className="grid gap-2 sm:grid-cols-2">
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
						placeholder={
							statusQuery.data?.apiKeyConfigured ? "•••••••• (leave blank to keep)" : "sk-…"
						}
						autoComplete="off"
					/>
				</div>

				<div className="flex items-center justify-between gap-4">
					<div>
						<Label htmlFor="ai-auto">Auto-explain on failure</Label>
						<p className="text-xs text-muted-foreground">
							When a deploy fails, Copilot analyzes the logs and shows the result on the Deployments
							tab
						</p>
					</div>
					<Switch id="ai-auto" checked={autoExplain} onCheckedChange={setAutoExplain} />
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						disabled={save.isPending}
						onClick={() =>
							save.mutate({
								enabled,
								provider,
								baseUrl: baseUrl.trim() || null,
								model: model.trim(),
								apiKey: apiKey.trim() || null,
								autoExplainOnFailure: autoExplain,
							})
						}
					>
						{save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
						Save
					</Button>
					{statusQuery.data?.apiKeyConfigured && (
						<Button
							type="button"
							variant="outline"
							disabled={save.isPending}
							onClick={() => save.mutate({ clearApiKey: true })}
						>
							Clear API key
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
