"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function SystemTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [pruneOpen, setPruneOpen] = useState<"simple" | "volumes" | null>(null);

	const infoQuery = useQuery(trpc.docker.systemInfo.queryOptions({ serverId }));

	const pruneMutation = useMutation(
		trpc.docker.systemPrune.mutationOptions({
			onSuccess: (output) => {
				toast.success("System pruned", {
					description: output.trim().split("\n").pop() ?? undefined,
				});
				setPruneOpen(null);
				queryClient.invalidateQueries({
					queryKey: trpc.docker.systemInfo.queryKey({ serverId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (infoQuery.isLoading) return <Skeleton className="h-64 w-full" />;
	if (infoQuery.isError) return <DockerError error={infoQuery.error} />;

	const info = infoQuery.data;
	const server = info?.version?.Server;

	return (
		<div className="grid gap-4 pt-4 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Engine</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<div className="flex justify-between">
						<span className="text-muted-foreground">Server version</span>
						<span className="font-mono text-xs">{server?.Version ?? "—"}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">OS / Arch</span>
						<span className="font-mono text-xs">
							{server?.Os ?? "—"} / {server?.Arch ?? "—"}
						</span>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Cleanup</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<p className="text-xs text-muted-foreground">
						Remove stopped containers, unused networks and dangling images.
					</p>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" onClick={() => setPruneOpen("simple")}>
							System prune
						</Button>
						<Button variant="outline" size="sm" onClick={() => setPruneOpen("volumes")}>
							Prune incl. volumes
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card className="lg:col-span-2">
				<CardHeader>
					<CardTitle className="text-sm font-medium">Disk usage</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Type</TableHead>
								<TableHead>Total</TableHead>
								<TableHead>Active</TableHead>
								<TableHead>Size</TableHead>
								<TableHead>Reclaimable</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(info?.df ?? []).map((row) => (
								<TableRow key={row.Type}>
									<TableCell className="text-xs font-medium">{row.Type}</TableCell>
									<TableCell className="text-xs">{row.TotalCount}</TableCell>
									<TableCell className="text-xs">{row.Active}</TableCell>
									<TableCell className="font-mono text-xs">{row.Size}</TableCell>
									<TableCell className="font-mono text-xs">{row.Reclaimable}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<AlertDialog open={pruneOpen !== null} onOpenChange={(open) => !open && setPruneOpen(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{pruneOpen === "volumes" ? "System prune incl. volumes" : "System prune"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							Remove stopped containers, unused networks and dangling images
							{pruneOpen === "volumes" ? (
								<>
									{" "}
									<strong className="text-foreground">and all unused volumes (data loss)</strong>
								</>
							) : (
								""
							)}
							. Running services are not affected.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={pruneMutation.isPending}
							onClick={() => pruneMutation.mutate({ serverId, volumes: pruneOpen === "volumes" })}
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
