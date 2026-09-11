"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	Globe,
	Loader2,
	RefreshCw,
	Rocket,
	Server,
	ShieldAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useCapabilities } from "@/hooks/use-capabilities";
import { INSTANCE_ADMIN_HINT, missingCapabilityHint } from "@/lib/capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC, useTRPCClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TemplateLogo } from "./template-logo";
import type { TemplateSummary } from "./templates-view";

/** Env defaults containing this placeholder are generated server-side. */
const GENERATE_SECRET = "{{generateSecret}}";

type StepId = "destination" | "configure" | "domain";

/**
 * Why the caller cannot deploy this template, mirroring template.deploy's
 * server checks — or null when every gate passes. Used to disable Deploy
 * buttons up front instead of failing at the end of the wizard.
 */
export function templateDeployBlocker(
	template: Pick<TemplateSummary, "hostPrivileged">,
	access: { can: (capability: string) => boolean; isInstanceAdmin: boolean },
	options: { withDomain?: boolean } = {},
): string | null {
	if (!access.can("templates.deploy")) return missingCapabilityHint("templates.deploy");
	if (!access.can("secrets.write")) return missingCapabilityHint("secrets.write");
	if (template.hostPrivileged && !access.isInstanceAdmin) return INSTANCE_ADMIN_HINT;
	if (options.withDomain && !access.can("domains.manage")) {
		return missingCapabilityHint("domains.manage");
	}
	return null;
}

export function DeployTemplateDialog({
	template,
	onClose,
}: {
	template: TemplateSummary | null;
	onClose: () => void;
}) {
	return (
		<Sheet open={template !== null} onOpenChange={(open) => !open && onClose()}>
			{/* key resets the form when another template is selected */}
			{template && <DeployTemplateForm key={template.id} template={template} />}
		</Sheet>
	);
}

function TemplateMark({ template }: { template: Pick<TemplateSummary, "name" | "logo"> }) {
	return (
		<div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border">
			<TemplateLogo
				name={template.name}
				logo={template.logo}
				className="size-6"
				fallbackClassName="bg-secondary"
			/>
		</div>
	);
}

function StepRail({
	steps,
	current,
	onSelect,
}: {
	steps: { id: StepId; label: string }[];
	current: StepId;
	onSelect: (id: StepId) => void;
}) {
	const currentIndex = steps.findIndex((step) => step.id === current);
	return (
		<ol className="flex items-center gap-0.5">
			{steps.map((step, index) => {
				const done = index < currentIndex;
				const active = step.id === current;
				return (
					<li key={step.id} className="flex min-w-0 flex-1 items-center gap-0.5">
						<button
							type="button"
							disabled={index > currentIndex}
							onClick={() => onSelect(step.id)}
							className={cn(
								"flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
								active && "bg-secondary text-foreground",
								done && "text-foreground hover:bg-secondary/60",
								!active && !done && "text-muted-foreground",
								index > currentIndex && "cursor-not-allowed opacity-50",
							)}
						>
							<span
								className={cn(
									"flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
									active && "bg-foreground text-background",
									done && "bg-foreground/15 text-foreground",
									!active && !done && "bg-muted text-muted-foreground",
								)}
							>
								{done ? <Check className="size-3" /> : index + 1}
							</span>
							<span className="truncate font-medium">{step.label}</span>
						</button>
						{index < steps.length - 1 && (
							<span className="mx-0.5 hidden h-px w-3 shrink-0 bg-border sm:block" />
						)}
					</li>
				);
			})}
		</ol>
	);
}

function DeployTemplateForm({ template }: { template: TemplateSummary }) {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const router = useRouter();
	const access = useCapabilities();

	const { data: projects } = useQuery(trpc.project.all.queryOptions());

	const steps = useMemo(() => {
		const list: { id: StepId; label: string }[] = [{ id: "destination", label: "Destination" }];
		if (template.env.length > 0) {
			list.push({ id: "configure", label: "Configure" });
		}
		list.push({ id: "domain", label: "Domain" });
		return list;
	}, [template.env.length]);

	const [step, setStep] = useState<StepId>("destination");
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
	const [generatingHost, setGeneratingHost] = useState(false);

	const project = projects?.find((p) => p.projectId === projectId);
	const environments = useMemo(() => project?.environments ?? [], [project]);
	// The destination step should not ask when there is nothing to choose:
	// preselect the only project and the only environment.
	useEffect(() => {
		if (!projectId && projects?.length === 1) setProjectId(projects[0].projectId);
	}, [projectId, projects]);
	useEffect(() => {
		if (!environmentName && environments.length === 1) setEnvironmentName(environments[0].name);
	}, [environmentName, environments]);
	const stepIndex = steps.findIndex((entry) => entry.id === step);
	const isLastStep = stepIndex === steps.length - 1;

	const generateHost = async () => {
		setGeneratingHost(true);
		try {
			const generated = await trpcClient.domain.generateDomain.query({
				appName: template.id || template.name,
			});
			setDomainHost(generated);
		} catch (error) {
			toastError(error, "Failed to generate domain");
		} finally {
			setGeneratingHost(false);
		}
	};

	const onDomainToggle = (enabled: boolean) => {
		setDomainEnabled(enabled);
		if (enabled && !domainHost.trim()) {
			void generateHost();
		}
	};

	const deploy = useMutation(
		trpc.template.deploy.mutationOptions({
			onSuccess: async (result, variables) => {
				const href = `/dashboard/projects/${variables.projectId}/services/compose/${result.composeId}?tab=deployments`;
				// "View" survives the navigation below and re-opens the log tab
				// if the operator wandered off (UX audit F14).
				toast.success(`Deploying ${template.name} — watch the deployment logs`, {
					action: { label: "View", onClick: () => router.push(href) },
				});
				// A new compose service now exists in the target project — refresh
				// the project list, the project page and its compose service list.
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.project.all.queryKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.project.one.queryKey({
							projectId: variables.projectId,
						}),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.compose.all.queryKey({
							projectId: variables.projectId,
						}),
					}),
				]);
				router.push(href);
			},
			onError: (error) => toastError(error),
		}),
	);

	const submit = () => {
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

	const canContinueDestination = Boolean(projectId && environmentName);
	const withDomain = domainEnabled && Boolean(domainHost.trim());
	const blocker = templateDeployBlocker(template, access, { withDomain });
	const canDeploy =
		canContinueDestination &&
		!(domainEnabled && !domainHost.trim()) &&
		!generatingHost &&
		blocker === null;

	const goNext = () => {
		const next = steps[stepIndex + 1];
		if (next) setStep(next.id);
	};

	const goBack = () => {
		const prev = steps[stepIndex - 1];
		if (prev) setStep(prev.id);
	};

	return (
		<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
			<SheetHeader className="gap-2.5 space-y-0 border-b p-4 pr-12 text-left">
				<div className="flex items-start gap-3">
					<TemplateMark template={template} />
					<div className="min-w-0 flex-1">
						<SheetTitle className="truncate">Deploy {template.name}</SheetTitle>
						<SheetDescription className="line-clamp-2">{template.description}</SheetDescription>
					</div>
				</div>
				<StepRail
					steps={steps}
					current={step}
					onSelect={(id) => {
						const target = steps.findIndex((entry) => entry.id === id);
						if (target <= stepIndex) setStep(id);
					}}
				/>
			</SheetHeader>

			<div className="flex-1 overflow-y-auto px-4 py-4">
				{template.hostPrivileged && (
					<div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
						<ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
						<p className="text-sm text-muted-foreground">
							This template needs elevated host access (Docker socket and/or Linux capabilities).
							Only the instance admin can deploy it. <HelpLink slug="templates" />
						</p>
					</div>
				)}
				{blocker && !(template.hostPrivileged && blocker === INSTANCE_ADMIN_HINT) && (
					<div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
						<ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
						<p className="text-sm text-muted-foreground">You cannot deploy this: {blocker}.</p>
					</div>
				)}
				{step === "destination" && (
					<div className="flex flex-col gap-5">
						<div className="flex items-start gap-3 rounded-lg border bg-secondary/40 p-3">
							<Server className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								Pick where this compose stack should live. A new service is created in the chosen
								environment and its first deployment starts immediately.
							</p>
						</div>
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
							<Select
								value={environmentName}
								onValueChange={setEnvironmentName}
								disabled={!project}
							>
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
				)}

				{step === "configure" && (
					<div className="flex flex-col gap-4">
						<p className="text-sm text-muted-foreground">
							Leave generated secrets blank to create them automatically on deploy. Override any
							value you want to control yourself.
						</p>
						{template.env.map((entry) => {
							const generated = entry.default.includes(GENERATE_SECRET);
							return (
								<div key={entry.key} className="flex flex-col gap-1.5">
									<div className="flex items-center justify-between gap-2">
										<Label htmlFor={`env-${entry.key}`} className="font-mono text-xs">
											{entry.key}
										</Label>
										{generated && (
											<Badge variant="outline" className="text-[10px]">
												auto-generated
											</Badge>
										)}
									</div>
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

				{step === "domain" && (
					<div className="flex flex-col gap-5">
						<div className="rounded-lg border p-3">
							<p className="text-xs font-medium text-muted-foreground">Deploying to</p>
							<p className="mt-1 text-sm font-medium">
								{project?.name ?? "Project"}
								<span className="text-muted-foreground"> / </span>
								{environmentName || "environment"}
							</p>
							{domainEnabled && domainHost.trim() ? (
								<p className="mt-2 truncate font-mono text-xs text-muted-foreground">
									{domainHost.trim()}
								</p>
							) : (
								<p className="mt-2 text-xs text-muted-foreground">No public domain yet</p>
							)}
						</div>

						<div className="flex flex-col gap-3 rounded-lg border p-3">
							<div className="flex items-center justify-between gap-4">
								<div className="flex items-start gap-3">
									<Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<div className="flex flex-col gap-1">
										<Label htmlFor="template-domain-toggle">Add a domain</Label>
										<p className="text-xs text-muted-foreground">
											Routes to{" "}
											<Badge variant="secondary" className="font-mono text-xs">
												{template.suggestedDomain.serviceName}:{template.suggestedDomain.port}
											</Badge>
										</p>
									</div>
								</div>
								<Switch
									id="template-domain-toggle"
									checked={domainEnabled}
									onCheckedChange={onDomainToggle}
									disabled={!access.can("domains.manage")}
									title={
										access.can("domains.manage")
											? undefined
											: missingCapabilityHint("domains.manage")
									}
								/>
							</div>
							{domainEnabled && (
								<div className="flex flex-col gap-1.5 border-t pt-3">
									<Label htmlFor="template-domain-host">Host</Label>
									<div className="flex gap-2">
										<Input
											id="template-domain-host"
											placeholder="app.example.com"
											value={domainHost}
											onChange={(event) => setDomainHost(event.target.value)}
										/>
										<Button
											type="button"
											variant="outline"
											size="icon"
											onClick={() => void generateHost()}
											disabled={generatingHost}
											aria-label="Generate a free traefik.me domain"
											title="Generate a free traefik.me domain"
										>
											{generatingHost ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<RefreshCw className="size-4" />
											)}
										</Button>
									</div>
									<p className="text-xs text-muted-foreground">
										Custom hostname, or refresh for a free{" "}
										<span className="font-mono">*.traefik.me</span> domain.
									</p>
								</div>
							)}
						</div>
					</div>
				)}
			</div>

			<SheetFooter className="flex-row items-center justify-between gap-2 border-t sm:space-x-0">
				<Button
					type="button"
					variant="ghost"
					onClick={goBack}
					disabled={stepIndex === 0 || deploy.isPending}
				>
					<ArrowLeft className="size-4" />
					Back
				</Button>
				{isLastStep ? (
					<Button
						type="button"
						onClick={submit}
						disabled={!canDeploy || deploy.isPending}
						title={blocker ?? undefined}
					>
						{deploy.isPending ? (
							<>
								<Loader2 className="size-4 animate-spin" />
								Deploying…
							</>
						) : (
							<>
								<Rocket className="size-4" />
								Deploy {template.name}
							</>
						)}
					</Button>
				) : (
					<Button
						type="button"
						onClick={goNext}
						disabled={step === "destination" && !canContinueDestination}
					>
						Continue
						<ArrowRight className="size-4" />
					</Button>
				)}
			</SheetFooter>
		</SheetContent>
	);
}
