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
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps } from "./docker-view";

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
	const color =
		state === "running"
			? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
			: state === "restarting"
				? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
				: "text-muted-foreground";
	return (
		<Badge variant="outline" className={color}>
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

	const containersQuery = useQuery({
		...trpc.docker.containers.queryOptions({ serverId }),
		refetchInterval: 30_000,
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.docker.containers.queryKey({ serverId }),
		});

	const actionMutation = useMutation(
		trpc.docker.containerAction.mutationOptions({
			onSuccess: (_data, variables) => {
				toast.success(
					variables.action === "remove" ? "Container removed" : `Container ${variables.action}ed`,
				);
				setRemoving(null);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
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

			<div className="overflow-x-auto rounded-lg border border-border">
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
								<TableCell>
									<span className="font-mono text-xs font-medium">{container.Names}</span>{" "}
									{container.protected && (
										<Badge variant="outline" className="ml-1.5 text-muted-foreground">
											<Lock className="mr-1 size-3" />
											protected
										</Badge>
									)}
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
			</div>

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
