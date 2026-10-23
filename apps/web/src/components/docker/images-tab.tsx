"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
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

import { DockerError, type DockerTabProps, invalidateDockerQueries } from "./docker-view";

type ImageRow = {
	Repository: string;
	Tag: string;
	ID: string;
	Size: string;
	CreatedSince: string;
};
/** Module scope so the table view's memo is not invalidated every render. */
const searchImage = (row: ImageRow) => [row.Repository, row.Tag, row.ID];

export function ImagesTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [reference, setReference] = useState("");
	const [pruneOpen, setPruneOpen] = useState(false);

	const imagesQuery = useQuery(trpc.docker.images.queryOptions({ serverId }));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.docker.images.queryKey({ serverId }),
		});

	const pullMutation = useSaveMutation(
		trpc.docker.imagePull.mutationOptions({ onSuccess: () => setReference("") }),
		{ successMessage: "Image pulled", invalidate: [trpc.docker.images.queryKey({ serverId })] },
	);
	const removeMutation = useSaveMutation(trpc.docker.imageRemove.mutationOptions(), {
		successMessage: "Image removed",
		// Disk usage on the System tab changes too.
		onSuccess: () => void invalidateDockerQueries(queryClient, trpc, serverId),
	});
	const pruneMutation = useSaveMutation(
		trpc.docker.imagesPrune.mutationOptions({
			// The toast carries the pruned size, so it stays here.
			onSuccess: (output) =>
				toast.success("Dangling images pruned", {
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

	const images = (imagesQuery.data ?? []) as ImageRow[];
	const view = useTableView({ rows: images, search: searchImage });

	if (imagesQuery.isLoading) return <Skeleton className="h-64 w-full" />;
	if (imagesQuery.isError) return <DockerError error={imagesQuery.error} />;

	return (
		<div className="space-y-3 pt-4">
			<div className="flex flex-wrap items-center gap-2">
				<Input
					placeholder="nginx:alpine"
					value={reference}
					onChange={(event) => setReference(event.target.value)}
					className="w-64 font-mono text-xs"
					onKeyDown={(event) => {
						if (event.key === "Enter" && reference.trim() && !pullMutation.isPending) {
							pullMutation.mutate({ serverId, reference: reference.trim() });
						}
					}}
				/>
				<Button
					size="sm"
					disabled={!reference.trim() || pullMutation.isPending}
					onClick={() => pullMutation.mutate({ serverId, reference: reference.trim() })}
				>
					{pullMutation.isPending ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Download className="size-4" />
					)}
					Pull image
				</Button>
				<div className="ms-auto flex items-center gap-2">
					<TableSearch view={view} placeholder="Search images…" />
					<Button variant="outline" size="sm" onClick={() => setPruneOpen(true)}>
						Prune dangling
					</Button>
					<Button variant="outline" size="sm" onClick={invalidate}>
						<RefreshCw className="size-3.5" />
						Refresh
					</Button>
				</div>
			</div>

			<TableCard footer={<TablePagination view={view} noun="images" />}>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Repository</TableHead>
							<TableHead>Tag</TableHead>
							<TableHead>Image ID</TableHead>
							<TableHead>Size</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-16 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{view.visible.length === 0 ? <TableNoMatch view={view} colSpan={6} /> : null}
						{view.visible.map((image) => (
							<TableRow key={`${image.Repository}:${image.Tag}:${image.ID}`}>
								<TableCell className="font-mono text-xs font-medium">{image.Repository}</TableCell>
								<TableCell className="font-mono text-xs text-muted-foreground">
									{image.Tag}
								</TableCell>
								<TableCell className="font-mono text-xs text-muted-foreground">
									{image.ID.replace("sha256:", "").slice(0, 12)}
								</TableCell>
								<TableCell className="text-xs">{image.Size}</TableCell>
								<TableCell className="text-xs text-muted-foreground">
									{image.CreatedSince}
								</TableCell>
								<TableCell className="text-right">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Remove image"
										title="Remove image"
										disabled={removeMutation.isPending}
										onClick={() => removeMutation.mutate({ serverId, imageId: image.ID })}
									>
										<Trash2 className="size-3.5 text-destructive" />
									</Button>
								</TableCell>
							</TableRow>
						))}
						{images.length === 0 && (
							<TableRow>
								<TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
									No images on this server.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</TableCard>

			<AlertDialog open={pruneOpen} onOpenChange={setPruneOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Prune dangling images</AlertDialogTitle>
						<AlertDialogDescription>
							Remove all images not referenced by any container or tag. Tagged images are kept.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={pruneMutation.isPending}
							onClick={() => pruneMutation.mutate({ serverId, all: false })}
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
