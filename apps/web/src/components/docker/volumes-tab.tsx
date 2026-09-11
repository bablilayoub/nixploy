"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps, invalidateDockerQueries } from "./docker-view";

type VolumeRow = {
	Name: string;
	Driver: string;
	Mountpoint: string;
	protected?: boolean;
};

export function VolumesTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState<VolumeRow | null>(null);
	const [pruneOpen, setPruneOpen] = useState(false);

	const volumesQuery = useQuery(trpc.docker.volumes.queryOptions({ serverId }));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.docker.volumes.queryKey({ serverId }),
		});

	const removeMutation = useSaveMutation(
		trpc.docker.volumeRemove.mutationOptions({ onSuccess: () => setRemoving(null) }),
		{
			successMessage: "Volume removed",
			// Disk usage on the System tab changes too.
			onSuccess: () => void invalidateDockerQueries(queryClient, trpc, serverId),
		},
	);
	const pruneMutation = useSaveMutation(
		trpc.docker.volumesPrune.mutationOptions({
			// The toast carries the reclaimed size, so it stays here.
			onSuccess: (output) =>
				toast.success("Unused volumes pruned", {
					description: output.trim().split("\n").pop() ?? undefined,
				}),
		}),
		{
			onSuccess: () => {
				setPruneOpen(false);
				void invalidateDockerQueries(queryClient, trpc, serverId);
			},
		},
	);

	if (volumesQuery.isLoading) return <Skeleton className="h-64 w-full" />;
	if (volumesQuery.isError) return <DockerError error={volumesQuery.error} />;

	const volumes = (volumesQuery.data ?? []) as VolumeRow[];

	return (
		<div className="space-y-3 pt-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">{volumes.length} volumes</p>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={() => setPruneOpen(true)}>
						Prune unused
					</Button>
					<Button variant="outline" size="sm" onClick={invalidate}>
						<RefreshCw className="size-3.5" />
						Refresh
					</Button>
				</div>
			</div>

			<TableCard>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Driver</TableHead>
							<TableHead>Mountpoint</TableHead>
							<TableHead className="w-16 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{volumes.map((volume) => (
							<TableRow key={volume.Name}>
								<TableCell className="max-w-72">
									<span className="font-mono text-xs font-medium">{volume.Name}</span>{" "}
									{volume.protected && (
										<Badge variant="outline" className="ml-1.5 text-muted-foreground">
											<Lock className="mr-1 size-3" />
											protected
										</Badge>
									)}
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">{volume.Driver}</TableCell>
								<TableCell className="max-w-72 truncate font-mono text-xs text-muted-foreground">
									{volume.Mountpoint}
								</TableCell>
								<TableCell className="text-right">
									{!volume.protected && (
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove volume ${volume.Name}`}
											title="Remove volume"
											onClick={() => setRemoving(volume)}
										>
											<Trash2 className="size-3.5 text-destructive" />
										</Button>
									)}
								</TableCell>
							</TableRow>
						))}
						{volumes.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
									No volumes on this server.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</TableCard>

			<AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove volume</AlertDialogTitle>
						<AlertDialogDescription>
							Remove volume <span className="font-mono">{removing?.Name}</span>?{" "}
							<strong className="text-foreground">All data in it is permanently lost.</strong>{" "}
							Docker will refuse if a container still uses it.
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

			<AlertDialog open={pruneOpen} onOpenChange={setPruneOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Prune unused volumes</AlertDialogTitle>
						<AlertDialogDescription>
							Remove every volume not referenced by any container (including named volumes).
							Platform volumes such as <span className="font-mono">nixploy-postgres-data</span> are
							kept.{" "}
							<strong className="text-foreground">
								Data in orphaned volumes is permanently lost.
							</strong>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={pruneMutation.isPending}
							onClick={() => pruneMutation.mutate({ serverId })}
						>
							{pruneMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Prune
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
