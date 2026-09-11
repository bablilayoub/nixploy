"use client";

import { Loader2, MoreVertical, Play, RefreshCw, Rocket, Square } from "lucide-react";
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
	const { can } = useCapabilities();
	const applicationId = application.applicationId;
	const [confirmStop, setConfirmStop] = useState(false);
	const { deploy, redeploy, start, stop, isBusy } = actions;

	const isRunning = application.status === "running" || application.status === "done";
	const statusConfig = STATUS_CONFIG[application.status ?? "idle"] ?? STATUS_CONFIG.idle;

	const canDeploy = can("service.deploy");
	const canRuntime = can("service.runtime");
	const deployHint = canDeploy ? undefined : capabilityHint("service.deploy");
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
					<span className="flex items-center gap-1.5">
						<StatusDot
							status={statusConfig.status}
							className={statusConfig.status === "success" ? "animate-pulse" : undefined}
						/>
						<span>{statusConfig.label}</span>
						<span aria-hidden>·</span>
						<span>{application.description || application.appName}</span>
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
							<Button
								onClick={() => deploy.mutate({ applicationId })}
								disabled={isBusy || !canDeploy}
							>
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
									disabled={isBusy || !canDeploy}
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
											disabled={isBusy || !canDeploy}
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
