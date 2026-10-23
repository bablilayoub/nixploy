"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTableView } from "@/hooks/use-table-view";
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps } from "./docker-view";

type NetworkRow = {
	ID: string;
	Name: string;
	Driver: string;
	Scope: string;
	protected: boolean;
};
/** Module scope so the table view's memo is not invalidated every render. */
const searchNetwork = (row: NetworkRow) => [row.Name, row.Driver, row.Scope];

export function NetworksTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState<NetworkRow | null>(null);

	const networksQuery = useQuery(trpc.docker.networks.queryOptions({ serverId }));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.docker.networks.queryKey({ serverId }),
		});

	const removeMutation = useSaveMutation(
		trpc.docker.networkRemove.mutationOptions({ onSuccess: () => setRemoving(null) }),
		{
			successMessage: "Network removed",
			invalidate: [trpc.docker.networks.queryKey({ serverId })],
		},
	);

	const networks = (networksQuery.data ?? []) as NetworkRow[];
	const view = useTableView({ rows: networks, search: searchNetwork });

	if (networksQuery.isLoading) return <Skeleton className="h-64 w-full" />;
	if (networksQuery.isError) return <DockerError error={networksQuery.error} />;

	return (
		<div className="space-y-3 pt-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">{networks.length} networks</p>
				<div className="flex items-center gap-2">
					<TableSearch view={view} placeholder="Search networks…" />
					<Button variant="outline" size="sm" onClick={invalidate}>
						<RefreshCw className="size-3.5" />
						Refresh
					</Button>
				</div>
			</div>

			<TableCard footer={<TablePagination view={view} noun="networks" />}>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Driver</TableHead>
							<TableHead>Scope</TableHead>
							<TableHead className="w-20 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{networks.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
									No networks on this host.
								</TableCell>
							</TableRow>
						)}
						{view.visible.length === 0 ? <TableNoMatch view={view} colSpan={4} /> : null}
						{view.visible.map((network) => (
							<TableRow key={network.ID}>
								<TableCell className="max-w-72">
									{/* Swarm task names run past 60 characters; unconstrained the cell
									    pushed the rest of the row off the table. */}
									<span className="flex min-w-0 items-center gap-1.5">
										<span className="truncate font-mono text-xs font-medium" title={network.Name}>
											{network.Name}
										</span>
										{network.protected && (
											<Badge variant="outline" className="shrink-0 text-muted-foreground">
												<Lock className="mr-1 size-3" />
												protected
											</Badge>
										)}
									</span>
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">{network.Driver}</TableCell>
								<TableCell className="text-xs text-muted-foreground">{network.Scope}</TableCell>
								<TableCell className="text-right">
									{!network.protected && (
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove network ${network.Name}`}
											title="Remove network"
											onClick={() => setRemoving(network)}
										>
											<Trash2 className="size-3.5 text-destructive" />
										</Button>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableCard>

			<AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove network</AlertDialogTitle>
						<AlertDialogDescription>
							Remove network <span className="font-mono">{removing?.Name}</span>? Docker will refuse
							if any container is still attached.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeMutation.isPending}
							onClick={() => {
								if (removing) removeMutation.mutate({ serverId, name: removing.Name });
							}}
						>
							{removeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
