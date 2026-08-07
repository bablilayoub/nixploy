"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, Loader2, Trash2, Undo2 } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTRPC } from "@/lib/trpc";

import type { RollbackEntry } from "./types";

export function RollbacksManager({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [rollbackTarget, setRollbackTarget] = useState<RollbackEntry | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<RollbackEntry | null>(null);

	const {
		data: rollbacks,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(trpc.rollback.all.queryOptions({ applicationId }));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.rollback.all.queryKey({ applicationId }),
		});

	const rollback = useMutation(
		trpc.application.rollback.mutationOptions({
			onSuccess: () => {
				toast.success("Rolled back to pinned image");
				setRollbackTarget(null);
				invalidate();
				queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
				queryClient.invalidateQueries({
					queryKey: trpc.deployment.byApplication.pathKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const remove = useMutation(
		trpc.rollback.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Rollback image deleted");
				setDeleteTarget(null);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">Rollbacks</CardTitle>
				<CardDescription>
					Images pinned by previous successful deployments. Rolling back points the service at the
					selected image without a rebuild.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex flex-col gap-2">
						{["one", "two"].map((row) => (
							<Skeleton key={row} className="h-10 w-full" />
						))}
					</div>
				) : isError ? (
					<div className="flex flex-col items-center gap-2 py-10 text-center">
						<p className="text-sm text-muted-foreground">
							{error.message || "Failed to load rollbacks"}
						</p>
						<Button size="sm" variant="outline" onClick={() => refetch()}>
							Retry
						</Button>
					</div>
				) : !rollbacks || rollbacks.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-10 text-center">
						<History className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No rollback images yet. Successful deployments pin one automatically.
						</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Image</TableHead>
								<TableHead>Version</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rollbacks.map((entry) => (
								<TableRow key={entry.rollbackId}>
									<TableCell className="max-w-72 truncate font-mono text-xs">
										<Tooltip>
											<TooltipTrigger asChild>
												<span>{entry.image}</span>
											</TooltipTrigger>
											<TooltipContent>{entry.image}</TooltipContent>
										</Tooltip>
									</TableCell>
									<TableCell className="text-muted-foreground">{entry.version ?? "—"}</TableCell>
									<TableCell className="text-muted-foreground">
										{format(entry.createdAt, "MMM d, yyyy HH:mm")}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button variant="ghost" size="sm" onClick={() => setRollbackTarget(entry)}>
												<Undo2 className="size-4" />
												Rollback
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete rollback image"
												onClick={() => setDeleteTarget(entry)}
											>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>

			<AlertDialog
				open={rollbackTarget !== null}
				onOpenChange={(open) => !open && setRollbackTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Roll back to this image?</AlertDialogTitle>
						<AlertDialogDescription>
							The service will be pointed at{" "}
							<code className="rounded bg-muted px-1">{rollbackTarget?.image}</code> and a rollback
							deployment will be recorded.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								rollbackTarget &&
								rollback.mutate({ applicationId, rollbackId: rollbackTarget.rollbackId })
							}
							disabled={rollback.isPending}
						>
							{rollback.isPending && <Loader2 className="size-4 animate-spin" />}
							Rollback
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete rollback image?</AlertDialogTitle>
						<AlertDialogDescription>
							You will no longer be able to roll back to{" "}
							<code className="rounded bg-muted px-1">{deleteTarget?.image}</code>.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteTarget && remove.mutate({ rollbackId: deleteTarget.rollbackId })}
							disabled={remove.isPending}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
