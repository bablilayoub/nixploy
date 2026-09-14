"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Loader2,
	Lock,
	Play,
	RefreshCw,
	ScrollText,
	Square,
	Terminal as TerminalIcon,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LogViewer } from "@/components/services/log-viewer";
import { ServiceTerminal } from "@/components/services/terminal";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useLiveEventsConnected } from "@/hooks/use-live-events";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps, invalidateDockerQueries } from "./docker-view";

const ACTION_DONE: Record<"start" | "stop" | "restart" | "remove", string> = {
	start: "Container started",
	stop: "Container stopped",
	restart: "Container restarted",
	remove: "Container removed",
};

type ContainerRow = {
	ID: string;
	Image: string;
	Names: string;
	State: string;
	Status: string;
	Ports: string;
	CreatedAt: string;
	protected?: boolean;
};

function StateBadge({ state }: { state: string }) {
	const variant =
		state === "running" ? "success" : state === "restarting" ? "warning" : "secondary";
	return (
		<Badge variant={variant} className="capitalize">
			{state}
		</Badge>
	);
}

export function ContainersTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [logsOf, setLogsOf] = useState<ContainerRow | null>(null);
	const [terminalOf, setTerminalOf] = useState<ContainerRow | null>(null);
	const [removing, setRemoving] = useState<ContainerRow | null>(null);

	// `docker.containers` shells out to `docker ps` (or an SSH round-trip for a
	// managed server), so the old unconditional 30 s poll cost one shell-out per
	// open tab forever. `/ws/events` invalidates this query whenever a
	// deployment settles or the reconciler corrects a status; the timer is now
	// only a fallback for a disconnected socket.
	const live = useLiveEventsConnected();
	const containersQuery = useQuery({
		...trpc.docker.containers.queryOptions({ serverId }),
		refetchInterval: live ? false : 30_000,
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.docker.containers.queryKey({ serverId }),
		});

	const actionMutation = useMutation(
		trpc.docker.containerAction.mutationOptions({
			onSuccess: (_data, variables) => {
				toast.success(ACTION_DONE[variables.action]);
				setRemoving(null);
				if (variables.action === "remove") {
					// Disk usage on the System tab changes too.
					void invalidateDockerQueries(queryClient, trpc, serverId);
				} else {
					invalidate();
				}
			},
			onError: (error) => toastError(error),
		}),
	);

	if (containersQuery.isLoading) {
		return <Skeleton className="h-64 w-full" />;
	}
	if (containersQuery.isError) {
		return <DockerError error={containersQuery.error} />;
	}

	const containers = (containersQuery.data ?? []) as ContainerRow[];

	return (
		<div className="space-y-3 pt-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					{containers.length} container{containers.length === 1 ? "" : "s"}
				</p>
				<Button variant="outline" size="sm" onClick={invalidate}>
					<RefreshCw className="size-3.5" />
					Refresh
				</Button>
			</div>

			<TableCard>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Image</TableHead>
							<TableHead>State</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Ports</TableHead>
							<TableHead className="w-56 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{containers.map((container) => (
							<TableRow key={container.ID}>
								<TableCell className="max-w-72">
									{/* Swarm task names run past 60 characters; unconstrained the cell
									    pushed the rest of the row off the table. */}
									<span className="flex min-w-0 items-center gap-1.5">
										<span
											className="truncate font-mono text-xs font-medium"
											title={container.Names}
										>
											{container.Names}
										</span>
										{container.protected && (
											<Badge variant="outline" className="shrink-0 text-muted-foreground">
												<Lock className="mr-1 size-3" />
												protected
											</Badge>
										)}
									</span>
								</TableCell>
								<TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
									{container.Image}
								</TableCell>
								<TableCell>
									<StateBadge state={container.State} />
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">{container.Status}</TableCell>
								<TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
									{container.Ports || "—"}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex justify-end gap-1">
										{container.State === "running" ? (
											<>
												{!container.protected && (
													<>
														<Button
															variant="ghost"
															size="icon-sm"
															aria-label={`Stop ${container.Names}`}
															title="Stop"
															disabled={actionMutation.isPending}
															onClick={() =>
																actionMutation.mutate({
																	serverId,
																	containerId: container.ID,
																	action: "stop",
																})
															}
														>
															<Square className="size-3.5" />
														</Button>
														<Button
															variant="ghost"
															size="icon-sm"
															aria-label={`Restart ${container.Names}`}
															title="Restart"
															disabled={actionMutation.isPending}
															onClick={() =>
																actionMutation.mutate({
																	serverId,
																	containerId: container.ID,
																	action: "restart",
																})
															}
														>
															<RefreshCw className="size-3.5" />
														</Button>
													</>
												)}
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`View logs for ${container.Names}`}
													title="Logs"
													onClick={() => setLogsOf(container)}
												>
													<ScrollText className="size-3.5" />
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Open terminal for ${container.Names}`}
													title="Terminal"
													onClick={() => setTerminalOf(container)}
												>
													<TerminalIcon className="size-3.5" />
												</Button>
											</>
										) : (
											!container.protected && (
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Start ${container.Names}`}
													title="Start"
													disabled={actionMutation.isPending}
													onClick={() =>
														actionMutation.mutate({
															serverId,
															containerId: container.ID,
															action: "start",
														})
													}
												>
													<Play className="size-3.5" />
												</Button>
											)
										)}
										{!container.protected && (
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Remove ${container.Names}`}
												title="Remove"
												onClick={() => setRemoving(container)}
											>
												<Trash2 className="size-3.5 text-destructive" />
											</Button>
										)}
									</div>
								</TableCell>
							</TableRow>
						))}
						{containers.length === 0 && (
							<TableRow>
								<TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
									No containers on this server.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</TableCard>

			<Dialog open={logsOf !== null} onOpenChange={(open) => !open && setLogsOf(null)}>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Logs — {logsOf?.Names}</DialogTitle>
						<DialogDescription>Live container log stream.</DialogDescription>
					</DialogHeader>
					{logsOf && <LogViewer containerId={logsOf.ID} serverId={serverId} />}
				</DialogContent>
			</Dialog>

			<Dialog open={terminalOf !== null} onOpenChange={(open) => !open && setTerminalOf(null)}>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Terminal — {terminalOf?.Names}</DialogTitle>
						<DialogDescription>Interactive shell inside the container.</DialogDescription>
					</DialogHeader>
					{terminalOf && <ServiceTerminal containerId={terminalOf.ID} serverId={serverId} />}
				</DialogContent>
			</Dialog>

			<AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove container</AlertDialogTitle>
						<AlertDialogDescription>
							Remove <span className="font-mono">{removing?.Names}</span>
							{removing?.State === "running" ? " (running — it will be force-removed)" : ""}? This
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={actionMutation.isPending}
							onClick={() => {
								if (removing) {
									actionMutation.mutate({
										serverId,
										containerId: removing.ID,
										action: "remove",
									});
								}
							}}
						>
							{actionMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
