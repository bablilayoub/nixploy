"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, MoreVertical, Play, RefreshCw, Rocket, ScrollText, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { capabilityHint } from "@/components/services/capability-hint";
import { CopilotChatDrawer } from "@/components/services/copilot-chat-drawer";
import { PageHeader, StatusDot, type StatusDotStatus } from "@/components/shell";
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
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCapabilities } from "@/hooks/use-capabilities";
import {
	firstLine,
	useFollowDeployment,
	useRunningDeployments,
} from "@/hooks/use-running-deployments";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";
import type { ApplicationActions } from "./use-application-actions";

const STATUS_CONFIG: Record<string, { label: string; status: StatusDotStatus }> = {
	idle: { label: "Idle", status: "neutral" },
	running: { label: "Running", status: "success" },
	done: { label: "Done", status: "info" },
	error: { label: "Error", status: "error" },
};

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
	const baseStatus = STATUS_CONFIG[application.status ?? "idle"] ?? STATUS_CONFIG.idle;
	const statusConfig = inFlight
		? {
				label:
					inFlight.status === "queued"
						? `Queued${inFlight.queuePosition ? ` (#${inFlight.queuePosition})` : ""}`
						: "Deploying",
				status: "info" as StatusDotStatus,
			}
		: baseStatus;

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

	return (
		<>
			<PageHeader
				breadcrumb={
					<nav className="flex items-center gap-1.5">
						<Link
							href={`/dashboard/projects/${projectId}`}
							className="transition-colors hover:text-foreground"
						>
							{application.environment.project.name}
						</Link>
						<span aria-hidden>/</span>
						<span className="text-foreground">{application.name}</span>
					</nav>
				}
				title={application.name}
				description={
					<span className="flex flex-col gap-1">
						<span className="flex items-center gap-1.5">
							<StatusDot
								status={statusConfig.status}
								className={
									statusConfig.status === "success" || inFlight ? "animate-pulse" : undefined
								}
							/>
							<span>{statusConfig.label}</span>
							<span aria-hidden>·</span>
							<span>{application.description || application.appName}</span>
						</span>
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
						<CopilotChatDrawer
							target={{
								type: "application",
								id: applicationId,
								name: application.name,
							}}
						/>
						<DisabledHint hint={deployHint}>
							<Button onClick={() => deploy.mutate({ applicationId })} disabled={deployDisabled}>
								{deploy.isPending ? (
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
									onClick={() => redeploy.mutate({ applicationId })}
									disabled={deployDisabled}
								>
									{redeploy.isPending ? (
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
									onClick={() => setConfirmStop(true)}
									disabled={isBusy || !canRuntime}
								>
									{stop.isPending ? (
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
									onClick={() => start.mutate({ applicationId })}
									disabled={isBusy || !canRuntime}
								>
									{start.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Play className="size-4" />
									)}
									Start
								</Button>
							</DisabledHint>
						) : null}
						{(hasDeployed || isRunning) && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="outline"
										size="icon"
										className="sm:hidden"
										aria-label="More actions"
										disabled={isBusy}
									>
										<MoreVertical className="size-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{hasDeployed && (
										<DropdownMenuItem
											disabled={deployDisabled}
											title={deployHint}
											onClick={() => redeploy.mutate({ applicationId })}
										>
											<RefreshCw className="size-4" />
											Redeploy
										</DropdownMenuItem>
									)}
									{isRunning ? (
										<DropdownMenuItem
											disabled={isBusy || !canRuntime}
											title={runtimeHint}
											onClick={() => setConfirmStop(true)}
										>
											<Square className="size-4" />
											Stop
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											disabled={isBusy || !canRuntime}
											title={runtimeHint}
											onClick={() => start.mutate({ applicationId })}
										>
											<Play className="size-4" />
											Start
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</>
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
