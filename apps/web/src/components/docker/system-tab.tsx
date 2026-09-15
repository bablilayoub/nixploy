"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps, invalidateDockerQueries } from "./docker-view";

export function SystemTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [pruneOpen, setPruneOpen] = useState<"simple" | "volumes" | null>(null);
	// docker.systemPrune is cluster-wide and rejects everyone but the instance
	// admin (with or without a serverId) — keep the controls out of sight.
	const { isInstanceAdmin } = useCapabilities();

	const infoQuery = useQuery(trpc.docker.systemInfo.queryOptions({ serverId }));

	const pruneMutation = useSaveMutation(
		trpc.docker.systemPrune.mutationOptions({
			// The toast carries the reclaimed size, so it stays here.
			onSuccess: (output) =>
				toast.success("System pruned", {
					description: output.trim().split("\n").pop() ?? undefined,
				}),
		}),
		{
			onSuccess: () => {
				setPruneOpen(null);
				// Prune removes containers, networks, images and (optionally)
				// volumes — every cached list for this daemon is stale now.
				void invalidateDockerQueries(queryClient, trpc, serverId);
			},
		},
	);

	if (infoQuery.isLoading) return <Skeleton className="h-64 w-full" />;
	if (infoQuery.isError) return <DockerError error={infoQuery.error} />;

	const info = infoQuery.data;
	const server = info?.version?.Server;

	return (
		<SettingsStack className="pt-4 lg:grid lg:grid-cols-2">
			<SettingsSection title="Engine">
				<div className="space-y-2 text-sm">
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
				</div>
			</SettingsSection>

			{isInstanceAdmin && (
				<SettingsSection
					wide
					title="Cleanup"
					description="Remove stopped containers, unused networks and dangling images."
					actions={
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={() => setPruneOpen("simple")}>
								System prune
							</Button>
							<Button variant="outline" size="sm" onClick={() => setPruneOpen("volumes")}>
								Prune incl. volumes
							</Button>
						</div>
					}
				/>
			)}

			<SettingsSection title="Disk usage" className="lg:col-span-2">
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
			</SettingsSection>

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
							onClick={() =>
								pruneMutation.mutate({
									serverId,
									volumes: pruneOpen === "volumes",
								})
							}
						>
							{pruneMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Prune
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsStack>
	);
}
