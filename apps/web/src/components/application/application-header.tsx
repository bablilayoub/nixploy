"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreVertical, Play, RefreshCw, Rocket, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

const STATUS_CONFIG: Record<string, { label: string; status: StatusDotStatus }> = {
	idle: { label: "Idle", status: "neutral" },
	running: { label: "Running", status: "success" },
	done: { label: "Done", status: "info" },
	error: { label: "Error", status: "error" },
};

export function ApplicationHeader({
	application,
	projectId,
}: {
	application: Application;
	projectId: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const applicationId = application.applicationId;
	const [confirmStop, setConfirmStop] = useState(false);

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.application.one.queryKey({ applicationId }),
		});
		queryClient.invalidateQueries({
			queryKey: trpc.deployment.byApplication.pathKey(),
		});
	};

	const onError = (error: { message: string }) => toast.error(error.message);

	const deploy = useMutation(
		trpc.application.deploy.mutationOptions({
			onSuccess: () => {
				toast.success("Deployment queued");
				invalidate();
			},
			onError,
		}),
	);
	const redeploy = useMutation(
		trpc.application.redeploy.mutationOptions({
			onSuccess: () => {
				toast.success("Redeployment queued");
				invalidate();
			},
			onError,
		}),
	);
	const start = useMutation(
		trpc.application.start.mutationOptions({
			onSuccess: () => {
				toast.success("Application started");
				invalidate();
			},
			onError,
		}),
	);
	const stop = useMutation(
		trpc.application.stop.mutationOptions({
			onSuccess: () => {
				toast.success("Application stopped");
				invalidate();
			},
			onError,
		}),
	);

	const isRunning = application.status === "running" || application.status === "done";
	const isBusy = deploy.isPending || redeploy.isPending || start.isPending || stop.isPending;
	const statusConfig = STATUS_CONFIG[application.status ?? "idle"] ?? STATUS_CONFIG.idle;

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
						<Button onClick={() => deploy.mutate({ applicationId })} disabled={isBusy}>
							{deploy.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Rocket className="size-4" />
							)}
							Deploy
						</Button>
						<Button
							variant="outline"
							className="hidden sm:inline-flex"
							onClick={() => redeploy.mutate({ applicationId })}
							disabled={isBusy}
						>
							{redeploy.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<RefreshCw className="size-4" />
							)}
							Redeploy
						</Button>
						{isRunning ? (
							<Button
								variant="outline"
								className="hidden sm:inline-flex"
								onClick={() => setConfirmStop(true)}
								disabled={isBusy}
							>
								{stop.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Square className="size-4" />
								)}
								Stop
							</Button>
						) : (
							<Button
								variant="outline"
								className="hidden sm:inline-flex"
								onClick={() => start.mutate({ applicationId })}
								disabled={isBusy}
							>
								{start.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Play className="size-4" />
								)}
								Start
							</Button>
						)}
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
								<DropdownMenuItem
									disabled={isBusy}
									onClick={() => redeploy.mutate({ applicationId })}
								>
									<RefreshCw className="size-4" />
									Redeploy
								</DropdownMenuItem>
								{isRunning ? (
									<DropdownMenuItem disabled={isBusy} onClick={() => setConfirmStop(true)}>
										<Square className="size-4" />
										Stop
									</DropdownMenuItem>
								) : (
									<DropdownMenuItem
										disabled={isBusy}
										onClick={() => start.mutate({ applicationId })}
									>
										<Play className="size-4" />
										Start
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
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
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={stop.isPending}
							onClick={() => stop.mutate({ applicationId })}
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
