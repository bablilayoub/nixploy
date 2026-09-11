"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Layers, Loader2, Play, RefreshCw, Rocket, ScrollText, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { VolumeBackupsTab } from "@/components/backups/volume-backups-tab";
import { ComposeFileTab } from "@/components/compose/compose-file-tab";
import { DeploymentsTab } from "@/components/compose/deployments-tab";
import { DomainsTab } from "@/components/compose/domains-tab";
import { EnvironmentTab } from "@/components/compose/environment-tab";
import { GeneralTab } from "@/components/compose/general-tab";
import { LogsTab } from "@/components/compose/logs-tab";
import { MonitoringTab } from "@/components/compose/monitoring-tab";
import { SettingsTab } from "@/components/compose/settings-tab";
import { TerminalTab } from "@/components/compose/terminal-tab";
import { SchedulesTab } from "@/components/schedules/schedules-tab";
import { capabilityHint } from "@/components/services/capability-hint";
import { CopilotChatDrawer } from "@/components/services/copilot-chat-drawer";
import { ServiceStatusBadge } from "@/components/services/status-badge";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
import { PageHeader } from "@/components/shell";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capabilities";
import {
	firstLine,
	useFollowDeployment,
	useRunningDeployments,
} from "@/hooks/use-running-deployments";
import { useSyncedTab } from "@/hooks/use-synced-tab";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

export type ComposeService = inferRouterOutputs<AppRouter>["compose"]["one"];

const TOP_TABS = [
	"general",
	"compose-file",
	"deploy",
	"runtime",
	"domains",
	"environment",
	"settings",
];

/** Sub-tab → its top-level tab, so ?tab=logs / ?tab=deployments deep-link. */
const SUB_TAB_PARENT: Record<string, string> = {
	deployments: "deploy",
	schedules: "deploy",
	backups: "deploy",
	logs: "runtime",
	monitoring: "runtime",
	terminal: "runtime",
};

const SUB_TAB_DEFAULT: Record<string, string> = {
	deploy: "deployments",
	runtime: "logs",
};

export function ComposeDetail({ projectId, composeId }: { projectId: string; composeId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [tab, selectTab] = useSyncedTab(
		"general",
		(value) => TOP_TABS.includes(value) || value in SUB_TAB_PARENT,
	);
	const topTab = TOP_TABS.includes(tab) ? tab : (SUB_TAB_PARENT[tab] ?? "general");
	const subTab = (parent: string) =>
		SUB_TAB_PARENT[tab] === parent ? tab : SUB_TAB_DEFAULT[parent];
	const [confirmStop, setConfirmStop] = useState(false);
	const { can } = useCapabilities();
	const followDeployment = useFollowDeployment();

	const { data, isLoading, isError, error, refetch } = useQuery(
		trpc.compose.one.queryOptions({ composeId }),
	);
	// Live deploy state + status refresh on finish come from the shared
	// running-deployments query (UX audit F13) — no per-page timer.
	const { active } = useRunningDeployments({ composeId });
	const inFlight = active[0] ?? null;
	// Start / Redeploy only make sense once a deployment succeeded; the last
	// outcome also feeds the error line under the header (UX audit F2/F22).
	const recentDeployments = useQuery({
		...trpc.deployment.byCompose.queryOptions({ composeId, limit: 20 }),
		enabled: Boolean(data),
	});
	const lastDeployment = recentDeployments.data?.deployments[0] ?? null;

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.compose.one.queryKey({ composeId }),
		});
		queryClient.invalidateQueries({ queryKey: trpc.compose.all.pathKey() });
		queryClient.invalidateQueries({ queryKey: trpc.deployment.byCompose.pathKey() });
		// Wakes the shared running-deployments query (hairline, header, services table).
		queryClient.invalidateQueries({ queryKey: trpc.deployment.recent.pathKey() });
	};

	const onActionError = (error: unknown) =>
		toast.error(error instanceof Error ? error.message : "Action failed");

	const queued = (message: string) => (result: { deploymentId: string }) => {
		toast.success(message);
		invalidate();
		followDeployment(result.deploymentId);
	};

	const deployMutation = useMutation(
		trpc.compose.deploy.mutationOptions({
			onSuccess: queued("Deployment queued"),
			onError: onActionError,
		}),
	);
	const redeployMutation = useMutation(
		trpc.compose.redeploy.mutationOptions({
			onSuccess: queued("Redeployment queued"),
			onError: onActionError,
		}),
	);
	const stopMutation = useMutation(
		trpc.compose.stop.mutationOptions({
			onSuccess: () => {
				toast.success("Compose service stopped");
				setConfirmStop(false);
				invalidate();
			},
			onError: onActionError,
		}),
	);
	const startMutation = useMutation(
		trpc.compose.start.mutationOptions({
			onSuccess: () => {
				toast.success("Compose service started");
				invalidate();
			},
			onError: onActionError,
		}),
	);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-6">
				<div className="flex items-center gap-3">
					<Skeleton className="size-10 rounded-lg" />
					<div className="space-y-2">
						<Skeleton className="h-5 w-48" />
						<Skeleton className="h-4 w-72" />
					</div>
				</div>
				<Skeleton className="h-9 w-full max-w-2xl" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (isError || !data) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
				<Layers className="size-8 text-muted-foreground" />
				<p className="font-medium">Compose service not found</p>
				<p className="text-sm text-muted-foreground">
					{error?.message ?? "It may have been deleted, or you don't have access to it."}
				</p>
				{isError && (
					<Button variant="outline" size="sm" onClick={() => refetch()}>
						Retry
					</Button>
				)}
			</div>
		);
	}

	const compose = data;
	const anyActionPending =
		deployMutation.isPending ||
		redeployMutation.isPending ||
		stopMutation.isPending ||
		startMutation.isPending;
	const isRunning = compose.status === "running" || compose.status === "done";
	const hasDeployed =
		isRunning ||
		(recentDeployments.data?.deployments ?? []).some((deployment) => deployment.status === "done");
	const lastError =
		!inFlight && lastDeployment?.status === "error" ? firstLine(lastDeployment.errorMessage) : null;
	const canDeploy = can("service.deploy");
	const canRuntime = can("service.runtime");
	const readiness = compose.readiness;
	// Pre-flight (UX audit F2): same predicate the server enforces, shown as the hint.
	const deployHint = !canDeploy
		? capabilityHint("service.deploy")
		: readiness.canDeploy
			? undefined
			: readiness.reason;
	const deployDisabled = anyActionPending || !canDeploy || !readiness.canDeploy;
	const runtimeHint = canRuntime ? undefined : capabilityHint("service.runtime");

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				breadcrumb={
					<>
						<Link
							href={`/dashboard/projects/${projectId}`}
							className="transition-colors hover:text-foreground"
						>
							Project
						</Link>
						<span className="mx-1.5">/</span>
						Compose
					</>
				}
				title={
					<span className="flex items-center gap-2.5">
						{compose.name}
						{inFlight ? (
							<Badge variant="info" className="gap-1.5 font-normal">
								<Loader2 className="size-3 animate-spin" />
								{inFlight.status === "queued"
									? `Queued${inFlight.queuePosition ? ` (#${inFlight.queuePosition})` : ""}`
									: "Deploying"}
							</Badge>
						) : (
							<ServiceStatusBadge status={compose.status} />
						)}
					</span>
				}
				description={
					<span className="flex flex-col gap-1">
						<span>{compose.description ?? compose.appName}</span>
						{lastError && lastDeployment && (
							<span className="flex items-center gap-1.5 text-destructive">
								<span className="truncate">Last deployment failed: {lastError}</span>
								<button
									type="button"
									className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:underline"
									onClick={() => followDeployment(lastDeployment.deploymentId)}
								>
									<ScrollText className="size-3.5" />
									View logs
								</button>
							</span>
						)}
					</span>
				}
				actions={
					<>
						<CopilotChatDrawer target={{ type: "compose", id: composeId, name: compose.name }} />
						<DisabledHint hint={deployHint}>
							<Button
								disabled={deployDisabled}
								onClick={() => deployMutation.mutate({ composeId })}
							>
								{deployMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Rocket className="size-4" />
								)}
								Deploy
							</Button>
						</DisabledHint>
						{hasDeployed && (
							<DisabledHint hint={deployHint} className="hidden sm:inline-flex">
								<Button
									variant="outline"
									disabled={deployDisabled}
									onClick={() => redeployMutation.mutate({ composeId })}
								>
									{redeployMutation.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<RefreshCw className="size-4" />
									)}
									Redeploy
								</Button>
							</DisabledHint>
						)}
						{isRunning ? (
							<DisabledHint hint={runtimeHint} className="hidden sm:inline-flex">
								<Button
									variant="outline"
									disabled={anyActionPending || !canRuntime}
									onClick={() => setConfirmStop(true)}
								>
									{stopMutation.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Square className="size-4" />
									)}
									Stop
								</Button>
							</DisabledHint>
						) : hasDeployed ? (
							<DisabledHint hint={runtimeHint} className="hidden sm:inline-flex">
								<Button
									variant="outline"
									disabled={anyActionPending || !canRuntime}
									onClick={() => startMutation.mutate({ composeId })}
								>
									{startMutation.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Play className="size-4" />
									)}
									Start
								</Button>
							</DisabledHint>
						) : null}
					</>
				}
			/>

			<Tabs value={topTab} onValueChange={selectTab}>
				<UnderlineTabsList>
					<UnderlineTabsTrigger value="general">General</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="compose-file">Compose File</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="deploy">Deploy</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="runtime">Runtime</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="domains">Domains</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="environment">Environment</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="settings">Settings</UnderlineTabsTrigger>
				</UnderlineTabsList>
				<TabsContent value="general" className="mt-6">
					<GeneralTab compose={compose} onOpenComposeFile={() => selectTab("compose-file")} />
				</TabsContent>
				<TabsContent value="compose-file" className="mt-6">
					<ComposeFileTab compose={compose} />
				</TabsContent>
				<TabsContent value="deploy" className="mt-6">
					<Tabs value={subTab("deploy")} onValueChange={selectTab} className="w-full gap-4">
						<SubTabsList>
							<SubTabsTrigger value="deployments">Deployments</SubTabsTrigger>
							<SubTabsTrigger value="schedules">Schedules</SubTabsTrigger>
							<SubTabsTrigger value="backups">Backups</SubTabsTrigger>
						</SubTabsList>
						<TabsContent value="deployments" className="mt-0">
							<DeploymentsTab compose={compose} />
						</TabsContent>
						<TabsContent value="schedules" className="mt-0">
							<SchedulesTab serviceType="compose" serviceId={compose.composeId} />
						</TabsContent>
						<TabsContent value="backups" className="mt-0">
							<VolumeBackupsTab serviceType="compose" serviceId={compose.composeId} />
						</TabsContent>
					</Tabs>
				</TabsContent>
				<TabsContent value="runtime" className="mt-6">
					<Tabs value={subTab("runtime")} onValueChange={selectTab} className="w-full gap-4">
						<SubTabsList>
							<SubTabsTrigger value="logs">Logs</SubTabsTrigger>
							<SubTabsTrigger value="monitoring">Monitoring</SubTabsTrigger>
							<SubTabsTrigger value="terminal">Terminal</SubTabsTrigger>
						</SubTabsList>
						<TabsContent value="logs" className="mt-0">
							<LogsTab compose={compose} />
						</TabsContent>
						<TabsContent value="monitoring" className="mt-0">
							<MonitoringTab compose={compose} />
						</TabsContent>
						<TabsContent value="terminal" className="mt-0">
							<TerminalTab compose={compose} />
						</TabsContent>
					</Tabs>
				</TabsContent>
				<TabsContent value="domains" className="mt-6">
					<DomainsTab compose={compose} />
				</TabsContent>
				<TabsContent value="environment" className="mt-6">
					<EnvironmentTab compose={compose} />
				</TabsContent>
				<TabsContent value="settings" className="mt-6">
					<SettingsTab projectId={projectId} compose={compose} />
				</TabsContent>
			</Tabs>

			<AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Stop compose service</AlertDialogTitle>
						<AlertDialogDescription>
							Stop {compose.name}? Its containers will go offline until you start it again.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={stopMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={stopMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								stopMutation.mutate({ composeId });
							}}
						>
							{stopMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Stop
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
