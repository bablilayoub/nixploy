"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Layers, Play, RefreshCw, Rocket, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
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
import { CopilotChatDrawer } from "@/components/services/copilot-chat-drawer";
import { ServiceStatusBadge } from "@/components/services/status-badge";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

export type ComposeService = inferRouterOutputs<AppRouter>["compose"]["one"];

export function ComposeDetail({ projectId, composeId }: { projectId: string; composeId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [tab, setTab] = useState("general");

	const { data, isLoading, isError } = useQuery(trpc.compose.one.queryOptions({ composeId }));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.compose.one.queryKey({ composeId }),
		});

	const onActionError = (error: unknown) =>
		toast.error(error instanceof Error ? error.message : "Action failed");

	const deployMutation = useMutation(
		trpc.compose.deploy.mutationOptions({
			onSuccess: () => {
				toast.success("Deployment queued");
				invalidate();
			},
			onError: onActionError,
		}),
	);
	const redeployMutation = useMutation(
		trpc.compose.redeploy.mutationOptions({
			onSuccess: () => {
				toast.success("Redeployment queued");
				invalidate();
			},
			onError: onActionError,
		}),
	);
	const stopMutation = useMutation(
		trpc.compose.stop.mutationOptions({
			onSuccess: () => {
				toast.success("Compose service stopped");
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
					It may have been deleted, or you don't have access to it.
				</p>
			</div>
		);
	}

	const compose = data;
	const anyActionPending =
		deployMutation.isPending ||
		redeployMutation.isPending ||
		stopMutation.isPending ||
		startMutation.isPending;
	const isRunning = compose.status === "running";

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
						<ServiceStatusBadge status={compose.status} />
					</span>
				}
				description={compose.description ?? compose.appName}
				actions={
					<>
						<CopilotChatDrawer target={{ type: "compose", id: composeId, name: compose.name }} />
						<Button
							disabled={anyActionPending}
							onClick={() => deployMutation.mutate({ composeId })}
						>
							<Rocket className="size-4" />
							Deploy
						</Button>
						<Button
							variant="outline"
							disabled={anyActionPending}
							onClick={() => redeployMutation.mutate({ composeId })}
						>
							<RefreshCw className="size-4" />
							Redeploy
						</Button>
						{isRunning ? (
							<Button
								variant="outline"
								disabled={anyActionPending}
								onClick={() => stopMutation.mutate({ composeId })}
							>
								<Square className="size-4" />
								Stop
							</Button>
						) : (
							<Button
								variant="outline"
								disabled={anyActionPending}
								onClick={() => startMutation.mutate({ composeId })}
							>
								<Play className="size-4" />
								Start
							</Button>
						)}
					</>
				}
			/>

			<Tabs value={tab} onValueChange={setTab}>
				<TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
					<TabsTrigger value="general">General</TabsTrigger>
					<TabsTrigger value="compose-file">Compose File</TabsTrigger>
					<TabsTrigger value="environment">Environment</TabsTrigger>
					<TabsTrigger value="domains">Domains</TabsTrigger>
					<TabsTrigger value="deployments">Deployments</TabsTrigger>
					<TabsTrigger value="logs">Logs</TabsTrigger>
					<TabsTrigger value="monitoring">Monitoring</TabsTrigger>
					<TabsTrigger value="terminal">Terminal</TabsTrigger>
					<TabsTrigger value="schedules">Schedules</TabsTrigger>
					<TabsTrigger value="backups">Volume Backups</TabsTrigger>
					<TabsTrigger value="settings">Settings</TabsTrigger>
				</TabsList>
				<TabsContent value="general">
					<GeneralTab compose={compose} />
				</TabsContent>
				<TabsContent value="compose-file">
					<ComposeFileTab compose={compose} />
				</TabsContent>
				<TabsContent value="environment">
					<EnvironmentTab compose={compose} />
				</TabsContent>
				<TabsContent value="domains">
					<DomainsTab compose={compose} />
				</TabsContent>
				<TabsContent value="deployments">
					<DeploymentsTab compose={compose} />
				</TabsContent>
				<TabsContent value="logs">
					<LogsTab compose={compose} />
				</TabsContent>
				<TabsContent value="monitoring">
					<MonitoringTab compose={compose} />
				</TabsContent>
				<TabsContent value="terminal">
					<TerminalTab compose={compose} />
				</TabsContent>
				<TabsContent value="schedules">
					<SchedulesTab serviceType="compose" serviceId={compose.composeId} />
				</TabsContent>
				<TabsContent value="backups">
					<VolumeBackupsTab serviceType="compose" serviceId={compose.composeId} />
				</TabsContent>
				<TabsContent value="settings">
					<SettingsTab projectId={projectId} compose={compose} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
