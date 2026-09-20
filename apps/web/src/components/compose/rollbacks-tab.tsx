"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, Loader2, Undo2 } from "lucide-react";
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
import { TableNoMatch, TablePagination, TableSearch } from "@/components/ui/table-toolbar";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useFollowDeployment } from "@/hooks/use-running-deployments";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTableView } from "@/hooks/use-table-view";
import { useTRPC } from "@/lib/trpc";

import type { ComposeService } from "./compose-detail";

type RollbackTarget = {
	snapshotId: string;
	deploymentId: string;
	createdAt: string | Date;
	deployment: {
		title: string;
		description: string | null;
		commitSha: string | null;
		commitMessage: string | null;
	} | null;
};

/**
 * Compose rollbacks (product audit, Databases row). An application rolls back
 * to a pinned image; a stack has none, so the target is the compose file + env
 * that deployment rendered — restored onto the row, then deployed normally.
 */
export function RollbacksTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const followDeployment = useFollowDeployment();
	const canDeploy = can("service.deploy");
	const deployHint = canDeploy ? undefined : capabilityHint("service.deploy");
	const composeId = compose.composeId;
	const isGitBacked = compose.sourceType !== "raw";

	const [target, setTarget] = useState<RollbackTarget | null>(null);

	const {
		data: targets,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(trpc.compose.rollbackTargets.queryOptions({ composeId }));

	const snapshotView = useTableView({
		rows: targets ?? [],
		search: (entry) => [entry.deployment?.title, entry.deployment?.commitSha],
	});

	const rollback = useSaveMutation(
		trpc.compose.rollback.mutationOptions({
			onSuccess: (result) => {
				setTarget(null);
				followDeployment(result.deploymentId);
			},
		}),
		{
			successMessage: "Rollback queued",
			invalidate: [
				trpc.compose.rollbackTargets.queryKey({ composeId }),
				trpc.compose.one.queryKey({ composeId }),
				trpc.deployment.byCompose.pathKey(),
				trpc.deployment.recent.pathKey(),
			],
		},
	);

	return (
		<>
			<SettingsSection
				wide
				title="Rollbacks"
				description={
					isGitBacked
						? "Snapshots of what each successful deploy ran. The compose file comes from your repository, so a rollback restores the environment variables only."
						: "Snapshots of the compose file and environment variables each successful deploy ran. Roll back without editing anything."
				}
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
				) : !targets || targets.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-10 text-center">
						<History className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No snapshots yet. Successful deployments record one automatically.
						</p>
					</div>
				) : (
					<>
						{snapshotView.showSearch ? (
							<div className="mb-3 flex flex-wrap items-center gap-2">
								<TableSearch view={snapshotView} placeholder="Search snapshots…" />
							</div>
						) : null}
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Deployment</TableHead>
									<TableHead>Commit</TableHead>
									<TableHead>Created</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								<TableNoMatch view={snapshotView} colSpan={4} />
								{snapshotView.visible.map((entry) => (
									<TableRow key={entry.snapshotId}>
										<TableCell>
											<div className="flex items-center gap-2">
												<span>{entry.deployment?.title ?? "Deployment"}</span>
												{/* The newest snapshot of the whole list, not of this page. */}
												{entry.snapshotId === targets[0]?.snapshotId ? (
													<Badge variant="outline">Current</Badge>
												) : null}
											</div>
										</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">
											{entry.deployment?.commitSha?.slice(0, 7) ?? "—"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{format(entry.createdAt, "MMM d, yyyy HH:mm")}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="ghost"
												size="sm"
												disabled={!canDeploy}
												title={deployHint}
												onClick={() => setTarget(entry)}
											>
												<Undo2 className="size-4" />
												Rollback
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						<TablePagination className="mt-3" view={snapshotView} noun="snapshots" />
					</>
				)}
			</SettingsSection>

			<AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Roll back to this snapshot?</AlertDialogTitle>
						<AlertDialogDescription>
							{isGitBacked
								? "The environment variables of that deployment will be restored and the stack redeployed. The compose file is read from your repository, so it is not rolled back."
								: "The compose file and environment variables of that deployment will be restored and the stack redeployed."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={rollback.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (target) {
									rollback.mutate({ composeId, snapshotId: target.snapshotId });
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
		</>
	);
}
