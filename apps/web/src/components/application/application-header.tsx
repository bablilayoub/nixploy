"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, RefreshCw, Rocket, Square } from "lucide-react";
import { useState } from "react";

import { capabilityHint } from "@/components/services/capability-hint";
import { CopilotChatDrawer } from "@/components/services/copilot-chat-drawer";
import { type ServiceActions, ServicePageHeader } from "@/components/services/service-page-header";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import {
	firstLine,
	useFollowDeployment,
	useRunningDeployments,
} from "@/hooks/use-running-deployments";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";
import type { ApplicationActions } from "./use-application-actions";

export function ApplicationHeader({
	application,
	projectId,
	actions,
	hasDeployed,
}: {
	application: Application;
	projectId: string;
	/** Lifecycle mutations owned by the page (shared with the runtime empty states). */
	actions: ApplicationActions;
	/**
	 * A successful deployment exists, so Start / Redeploy can succeed. Before
	 * that the server answers PRECONDITION_FAILED — the buttons stay hidden.
	 */
	hasDeployed: boolean;
}) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;
	const [confirmStop, setConfirmStop] = useState(false);
	const { deploy, redeploy, start, stop, isBusy } = actions;
	const followDeployment = useFollowDeployment();

	// Live deploy state (UX audit F13): the shared running-deployments query
	// tells us a build is queued/running before `application.status` moves.
	const { active } = useRunningDeployments({ applicationId });
	const inFlight = active[0] ?? null;
	// Last outcome, for the error line under the status (UX audit F2).
	const lastDeploymentQuery = useQuery(
		trpc.deployment.byApplication.queryOptions({ applicationId, limit: 1 }),
	);
	const lastDeployment = lastDeploymentQuery.data?.deployments[0] ?? null;
	const lastError =
		!inFlight && lastDeployment?.status === "error" ? firstLine(lastDeployment.errorMessage) : null;

	const isRunning = application.status === "running" || application.status === "done";
	const canDeploy = can("service.deploy");
	const canRuntime = can("service.runtime");
	const readiness = application.readiness;
	// Pre-flight (UX audit F2): the server refuses unconfigured sources with
	// the same message, so the button explains instead of toasting a failure.
	const deployHint = !canDeploy
		? capabilityHint("service.deploy")
		: readiness.canDeploy
			? undefined
			: readiness.reason;
	const deployDisabled = isBusy || !canDeploy || !readiness.canDeploy;
	const runtimeHint = canRuntime ? undefined : capabilityHint("service.runtime");

	const serviceActions: ServiceActions = [
		{
			key: "deploy",
			label: "Deploy",
			icon: Rocket,
			primary: true,
			onClick: () => deploy.mutate({ applicationId }),
			pending: deploy.isPending,
			disabled: deployDisabled,
			hint: deployHint,
		},
	];
	if (hasDeployed) {
		serviceActions.push({
			key: "redeploy",
			label: "Redeploy",
			icon: RefreshCw,
			onClick: () => redeploy.mutate({ applicationId }),
			pending: redeploy.isPending,
			disabled: deployDisabled,
			hint: deployHint,
		});
	}
	if (isRunning) {
		serviceActions.push({
			key: "stop",
			label: "Stop",
			icon: Square,
			onClick: () => setConfirmStop(true),
			pending: stop.isPending,
			disabled: isBusy || !canRuntime,
			hint: runtimeHint,
		});
	} else if (hasDeployed) {
		serviceActions.push({
			key: "start",
			label: "Start",
			icon: Play,
			onClick: () => start.mutate({ applicationId }),
			pending: start.isPending,
			disabled: isBusy || !canRuntime,
			hint: runtimeHint,
		});
	}

	return (
		<>
			<ServicePageHeader
				projectId={projectId}
				projectName={application.environment.project.name}
				environmentName={application.environment.name}
				name={application.name}
				subtitle={application.description || application.appName}
				status={application.status}
				inFlight={inFlight}
				actions={serviceActions}
				lastError={lastError}
				onViewLogs={
					lastDeployment ? () => followDeployment(lastDeployment.deploymentId) : undefined
				}
				before={
					<CopilotChatDrawer
						target={{
							type: "application",
							id: applicationId,
							name: application.name,
						}}
					/>
				}
			/>
			<AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Stop application</AlertDialogTitle>
						<AlertDialogDescription>
							Stop {application.name}? It will go offline until you start it again.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={stop.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={stop.isPending}
							onClick={(event) => {
								event.preventDefault();
								stop.mutate({ applicationId }, { onSuccess: () => setConfirmStop(false) });
							}}
						>
							{stop.isPending && <Loader2 className="size-4 animate-spin" />}
							Stop
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
