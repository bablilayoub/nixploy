"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, Loader2, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
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
import { TableNoMatch, TablePagination, TableSearch } from "@/components/ui/table-toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTableView } from "@/hooks/use-table-view";
import { useTRPC } from "@/lib/trpc";

import type { RollbackEntry } from "./types";

export function RollbacksManager({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	// Rolling back and pruning pinned images are both gated on service.deploy.
	const canDeploy = can("service.deploy");
	const deployHint = canDeploy ? undefined : capabilityHint("service.deploy");

	const [rollbackTarget, setRollbackTarget] = useState<RollbackEntry | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<RollbackEntry | null>(null);

	const {
		data: rollbacks,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(trpc.rollback.all.queryOptions({ applicationId }));

	const rollbacksKey = trpc.rollback.all.queryKey({ applicationId });

	const rollback = useSaveMutation(
		trpc.application.rollback.mutationOptions({ onSuccess: () => setRollbackTarget(null) }),
		{
			successMessage: "Rolled back to pinned image",
			invalidate: [
				rollbacksKey,
				trpc.application.one.queryKey({ applicationId }),
				trpc.deployment.byApplication.pathKey(),
			],
		},
	);

	const remove = useSaveMutation(
		trpc.rollback.delete.mutationOptions({ onSuccess: () => setDeleteTarget(null) }),
		{ successMessage: "Rollback image deleted", invalidate: [rollbacksKey] },
	);

	const rollbackView = useTableView({
		rows: rollbacks ?? [],
		search: (entry) => [entry.image, entry.version, entry.deployment?.title],
	});

	return (
		<>
			<SettingsSection
				wide
				title="Rollbacks"
				description="Images from past successful deploys. Roll back without rebuilding."
			>
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
					<>
						{rollbackView.showSearch ? (
							<div className="mb-3 flex flex-wrap items-center gap-2">
								<TableSearch view={rollbackView} placeholder="Search images…" />
							</div>
						) : null}
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Image</TableHead>
									{/* It is the local tag the image is pinned under, derived from the
								    deployment id — "Version" read like a release number. */}
									<TableHead>Image tag</TableHead>
									<TableHead>Created</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								<TableNoMatch view={rollbackView} colSpan={4} />
								{rollbackView.visible.map((entry) => (
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
												<Button
													variant="ghost"
													size="sm"
													disabled={!canDeploy}
													title={deployHint}
													onClick={() => setRollbackTarget(entry)}
												>
													<Undo2 className="size-4" />
													Rollback
												</Button>
												<Button
													variant="ghost"
													size="sm"
													aria-label="Delete rollback image"
													disabled={!canDeploy}
													title={deployHint}
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
						<TablePagination className="mt-3" view={rollbackView} noun="images" />
					</>
				)}
			</SettingsSection>

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
						<AlertDialogCancel disabled={rollback.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (rollbackTarget) {
									rollback.mutate({
										applicationId,
										rollbackId: rollbackTarget.rollbackId,
									});
								}
							}}
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
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								if (deleteTarget) remove.mutate({ rollbackId: deleteTarget.rollbackId });
							}}
							disabled={remove.isPending}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
