"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps } from "./docker-view";

type NetworkRow = {
	ID: string;
	Name: string;
	Driver: string;
	Scope: string;
	protected: boolean;
};

export function NetworksTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState<NetworkRow | null>(null);

	const networksQuery = useQuery(trpc.docker.networks.queryOptions({ serverId }));

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: trpc.docker.networks.queryKey({ serverId }) });

	const removeMutation = useMutation(
		trpc.docker.networkRemove.mutationOptions({
			onSuccess: () => {
				toast.success("Network removed");
				setRemoving(null);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (networksQuery.isLoading) return <Skeleton className="h-64 w-full" />;
	if (networksQuery.isError) return <DockerError error={networksQuery.error} />;

	const networks = (networksQuery.data ?? []) as NetworkRow[];

	return (
		<div className="space-y-3 pt-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">{networks.length} networks</p>
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
						{networks.map((network) => (
							<TableRow key={network.ID}>
								<TableCell>
									<span className="font-mono text-xs font-medium">{network.Name}</span>{" "}
									{network.protected && (
										<Badge variant="outline" className="ml-1.5 text-muted-foreground">
											<Lock className="mr-1 size-3" />
											protected
										</Badge>
									)}
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
