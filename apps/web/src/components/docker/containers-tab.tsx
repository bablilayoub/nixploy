"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Loader2,
	Lock,
	MoreHorizontal,
	Play,
	RefreshCw,
	ScrollText,
	Square,
	Terminal as TerminalIcon,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/services/copy-button";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { TableNoMatch, TablePagination, TableSearch } from "@/components/ui/table-toolbar";
import { useLiveEventsConnected } from "@/hooks/use-live-events";
import { useTableView } from "@/hooks/use-table-view";
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

/** Module scope so the table view's memo is not invalidated every render. */
const searchContainer = (row: ContainerRow) => [row.Names, row.Image, row.State, row.Status];

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
	const [inspecting, setInspecting] = useState<ContainerRow | null>(null);
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

	const containers = (containersQuery.data ?? []) as ContainerRow[];
	const view = useTableView({ rows: containers, search: searchContainer });

	if (containersQuery.isLoading) {
		return <Skeleton className="h-64 w-full" />;
	}
	if (containersQuery.isError) {
		return (
			<DockerError error={containersQuery.error} onRetry={() => void containersQuery.refetch()} />
		);
	}

	return (
		<div className="space-y-4 pt-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{containers.length} container{containers.length === 1 ? "" : "s"}
				</p>
				<div className="flex items-center gap-2">
					<TableSearch view={view} placeholder="Search containers…" />
					<Button variant="outline" size="sm" onClick={invalidate}>
						<RefreshCw className="size-3.5" />
						Refresh
					</Button>
				</div>
			</div>

			<TableCard footer={<TablePagination view={view} noun="containers" />}>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Container</TableHead>
							<TableHead>State</TableHead>
							<TableHead>Ports</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{view.visible.length === 0 && <TableNoMatch view={view} colSpan={4} />}
						{view.visible.map((container) => (
							<TableRow key={container.ID}>
								<TableCell className="max-w-80">
									<button
										type="button"
										onClick={() => setInspecting(container)}
										className="block max-w-full truncate text-left font-mono text-xs font-medium underline-offset-4 hover:underline"
										title={container.Names}
										aria-label={`Inspect container ${container.Names}`}
									>
										{container.Names}
									</button>
									<p
										className="mt-1.5 max-w-80 truncate font-mono text-xs text-muted-foreground"
										title={container.Image}
									>
										{container.Image}
									</p>
									{container.protected && (
										<Badge variant="outline" className="mt-2 text-muted-foreground">
											<Lock className="size-3" />
											Protected
										</Badge>
									)}
								</TableCell>
								<TableCell>
									<StateBadge state={container.State} />
									<p className="mt-1.5 text-xs text-muted-foreground">{container.Status}</p>
								</TableCell>
								<TableCell className="max-w-56 whitespace-normal break-all font-mono text-xs text-muted-foreground">
									{container.Ports || "No published ports"}
								</TableCell>
								<TableCell>
									<div className="flex items-center justify-end gap-1">
										{container.State === "running" && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setLogsOf(container)}
												aria-label={`View logs for ${container.Names}`}
											>
												<ScrollText className="size-4" />
												Logs
											</Button>
										)}
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Actions for ${container.Names}`}
												>
													<MoreHorizontal className="size-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onSelect={() => setInspecting(container)}>
													Inspect container
												</DropdownMenuItem>
												{container.State === "running" && (
													<DropdownMenuItem onSelect={() => setTerminalOf(container)}>
														<TerminalIcon className="size-4" />
														Open terminal
													</DropdownMenuItem>
												)}
												{!container.protected && (
													<>
														<DropdownMenuSeparator />
														{container.State === "running" ? (
															<>
																<DropdownMenuItem
																	disabled={actionMutation.isPending}
																	onSelect={() =>
																		actionMutation.mutate({
																			serverId,
																			containerId: container.ID,
																			action: "restart",
																		})
																	}
																>
																	<RefreshCw className="size-4" />
																	Restart
																</DropdownMenuItem>
																<DropdownMenuItem
																	disabled={actionMutation.isPending}
																	onSelect={() =>
																		actionMutation.mutate({
																			serverId,
																			containerId: container.ID,
																			action: "stop",
																		})
																	}
																>
																	<Square className="size-4" />
																	Stop
																</DropdownMenuItem>
															</>
														) : (
															<DropdownMenuItem
																disabled={actionMutation.isPending}
																onSelect={() =>
																	actionMutation.mutate({
																		serverId,
																		containerId: container.ID,
																		action: "start",
																	})
																}
															>
																<Play className="size-4" />
																Start
															</DropdownMenuItem>
														)}
														<DropdownMenuSeparator />
														<DropdownMenuItem
															variant="destructive"
															onSelect={() => setRemoving(container)}
														>
															<Trash2 className="size-4" />
															Remove container
														</DropdownMenuItem>
													</>
												)}
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</TableCell>
							</TableRow>
						))}
						{containers.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
									No containers on this server.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</TableCard>

			<Dialog open={inspecting !== null} onOpenChange={(open) => !open && setInspecting(null)}>
				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Container details</DialogTitle>
						<DialogDescription>
							Identity and runtime information reported by Docker.
						</DialogDescription>
					</DialogHeader>
					{inspecting && (
						<dl className="grid gap-5">
							{[
								{ label: "Name", value: inspecting.Names },
								{ label: "Container ID", value: inspecting.ID },
								{ label: "Image", value: inspecting.Image },
								{ label: "Published ports", value: inspecting.Ports || "None" },
								{ label: "Created", value: inspecting.CreatedAt },
							].map((field) => (
								<div key={field.label}>
									<dt className="mb-1 text-xs text-muted-foreground">{field.label}</dt>
									<dd className="flex items-start justify-between gap-3">
										<span className="min-w-0 break-all font-mono text-sm">{field.value}</span>
										<CopyButton value={field.value} label={`Copy ${field.label.toLowerCase()}`} />
									</dd>
								</div>
							))}
						</dl>
					)}
				</DialogContent>
			</Dialog>

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
