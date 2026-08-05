"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";

import type { TemplateSummary } from "./templates-view";

/** Env defaults containing this placeholder are generated server-side. */
const GENERATE_SECRET = "{{generateSecret}}";

export function DeployTemplateDialog({
	template,
	onClose,
}: {
	template: TemplateSummary | null;
	onClose: () => void;
}) {
	return (
		<Dialog open={template !== null} onOpenChange={(open) => !open && onClose()}>
			{/* key resets the form when another template is selected */}
			{template && <DeployTemplateForm key={template.id} template={template} />}
		</Dialog>
	);
}

function DeployTemplateForm({ template }: { template: TemplateSummary }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();

	const { data: projects } = useQuery(trpc.project.all.queryOptions());

	const [projectId, setProjectId] = useState("");
	const [environmentName, setEnvironmentName] = useState("");
	const [envValues, setEnvValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			template.env.map((entry) => [
				entry.key,
				entry.default.includes(GENERATE_SECRET) ? "" : entry.default,
			]),
		),
	);
	const [domainEnabled, setDomainEnabled] = useState(false);
	const [domainHost, setDomainHost] = useState("");

	const project = projects?.find((p) => p.projectId === projectId);
	const environments = project?.environments ?? [];

	const deploy = useMutation(
		trpc.template.deploy.mutationOptions({
			onSuccess: async (result) => {
				toast.success(`Deploying ${template.name} — watch the deployment logs`);
				await queryClient.invalidateQueries({
					queryKey: trpc.project.all.queryKey(),
				});
				router.push(`/dashboard/projects/${projectId}/services/compose/${result.composeId}`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const submit = () => {
		// Empty values are omitted so schema defaults (and generated secrets)
		// apply server-side.
		const provided = Object.fromEntries(
			Object.entries(envValues).filter(([, value]) => value !== ""),
		);
		deploy.mutate({
			templateId: template.id,
			projectId,
			environmentName,
			envValues: provided,
			domains:
				domainEnabled && domainHost.trim()
					? [
							{
								host: domainHost.trim(),
								serviceName: template.suggestedDomain.serviceName,
								port: template.suggestedDomain.port,
							},
						]
					: undefined,
		});
	};

	return (
		<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
			<DialogHeader>
				<DialogTitle>Deploy {template.name}</DialogTitle>
				<DialogDescription>
					Creates a compose service from the {template.name} template and starts its first
					deployment.
				</DialogDescription>
			</DialogHeader>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
				className="flex flex-col gap-4"
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<Label>Project</Label>
						<Select
							value={projectId}
							onValueChange={(value) => {
								setProjectId(value);
								setEnvironmentName("");
							}}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select a project" />
							</SelectTrigger>
							<SelectContent>
								{projects?.map((p) => (
									<SelectItem key={p.projectId} value={p.projectId}>
										{p.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-2">
						<Label>Environment</Label>
						<Select value={environmentName} onValueChange={setEnvironmentName} disabled={!project}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select an environment" />
							</SelectTrigger>
							<SelectContent>
								{environments.map((environment) => (
									<SelectItem key={environment.environmentId} value={environment.name}>
										{environment.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				{template.env.length > 0 && (
					<div className="flex flex-col gap-3">
						<Label className="text-muted-foreground">Environment variables</Label>
						{template.env.map((entry) => {
							const generated = entry.default.includes(GENERATE_SECRET);
							return (
								<div key={entry.key} className="flex flex-col gap-1.5">
									<Label htmlFor={`env-${entry.key}`} className="font-mono text-xs">
										{entry.key}
									</Label>
									<Input
										id={`env-${entry.key}`}
										value={envValues[entry.key] ?? ""}
										placeholder={generated ? "Randomly generated on deploy" : entry.default}
										onChange={(event) =>
											setEnvValues((current) => ({
												...current,
												[entry.key]: event.target.value,
											}))
										}
									/>
									<p className="text-xs text-muted-foreground">{entry.description}</p>
								</div>
							);
						})}
					</div>
				)}

				<div className="flex flex-col gap-3 rounded-md border p-3">
					<div className="flex items-center justify-between gap-4">
						<div className="flex flex-col gap-1">
							<Label htmlFor="template-domain-toggle">Add a domain</Label>
							<p className="text-xs text-muted-foreground">
								Routes to{" "}
								<Badge variant="secondary" className="font-mono text-xs">
									{template.suggestedDomain.serviceName}:{template.suggestedDomain.port}
								</Badge>
							</p>
						</div>
						<Switch
							id="template-domain-toggle"
							checked={domainEnabled}
							onCheckedChange={setDomainEnabled}
						/>
					</div>
					{domainEnabled && (
						<Input
							placeholder="app.example.com"
							value={domainHost}
							onChange={(event) => setDomainHost(event.target.value)}
						/>
					)}
				</div>

				<DialogFooter>
					<Button
						type="submit"
						disabled={
							!projectId ||
							!environmentName ||
							(domainEnabled && !domainHost.trim()) ||
							deploy.isPending
						}
					>
						{deploy.isPending ? "Deploying..." : "Deploy"}
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
