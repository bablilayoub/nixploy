"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { CheckCircle2, History, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-toolbar";
import { useTableView } from "@/hooks/use-table-view";
import { describeError } from "@/lib/describe-error";
import { formatBytes, formatDuration } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

/** One `backup_run` row as returned by `backup.runs` / `volumeBackup.runs`. */
export type BackupRunRow = inferRouterOutputs<AppRouter>["backup"]["runs"][number];

/** The subset the list badges need (`lastRun` on `backup.all` / `volumeBackup.all`). */
export type LastRunSummary = Pick<
	BackupRunRow,
	"status" | "startedAt" | "finishedAt" | "error" | "trigger"
>;

const TRIGGER_LABELS: Record<string, string> = {
	schedule: "Scheduled",
	manual: "Manual",
	verify: "Verify",
};

function StatusBadge({ status, error }: { status: BackupRunRow["status"]; error: string | null }) {
	if (status === "running") {
		return (
			<Badge variant="warning">
				<Loader2 className="animate-spin" />
				Running
			</Badge>
		);
	}
	if (status === "success") {
		return (
			<Badge variant="success">
				<CheckCircle2 />
				Succeeded
			</Badge>
		);
	}
	return (
		<Badge variant="destructive" title={error ?? undefined}>
			<XCircle />
			Failed
		</Badge>
	);
}

/** "Last run" cell: status badge, when it finished and — for failures — the error. */
export function LastRunBadge({ run }: { run: LastRunSummary | null | undefined }) {
	if (!run) {
		return <Badge variant="outline">Never run</Badge>;
	}
	const when = run.finishedAt ?? run.startedAt;
	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex items-center gap-2">
				<StatusBadge status={run.status} error={run.error} />
				<DateTime value={when} className="text-xs text-muted-foreground" />
			</div>
			{run.status === "error" && run.error && (
				<p className="max-w-56 truncate text-xs text-destructive" title={run.error}>
					{run.error}
				</p>
			)}
		</div>
	);
}

/** How many runs the sheet lists. */
// Runs are paginated in the client, so the fetch can afford real history
// instead of the last twenty rows — the older ones were simply unreachable.
const RUNS_LIMIT = 100;
const RUNS_PAGE_SIZE = 10;

/**
 * "Runs" button + side sheet with the recent history of one backup. For
 * database/instance backups a successful run can be test-restored into a
 * throwaway container ("Verify"); the outcome shows up as a new run.
 */
export function BackupRunsSheet({
	kind,
	id,
	title,
	canManage,
	onChanged,
}: {
	kind: "backup" | "volumeBackup";
	id: string;
	title: string;
	canManage: boolean;
	/** Called after a verification finished so the parent list can refresh its badges. */
	onChanged?: () => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);

	const runsOptions =
		kind === "backup"
			? trpc.backup.runs.queryOptions({ backupId: id, limit: RUNS_LIMIT })
			: trpc.volumeBackup.runs.queryOptions({ volumeBackupId: id, limit: RUNS_LIMIT });
	const runsQuery = useQuery({
		...runsOptions,
		enabled: open,
		// A run in flight (manual, scheduled or a verification) finishes without
		// any client event — poll while one is visible.
		refetchInterval: (query) =>
			query.state.data?.some((run) => run.status === "running") ? 5000 : false,
	});
	const runs = runsQuery.data ?? [];
	const view = useTableView({
		rows: runs,
		// Nothing here reads as a name, so the pager carries the whole job.
		search: () => [],
		pageSize: RUNS_PAGE_SIZE,
		searchFrom: Number.POSITIVE_INFINITY,
	});

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: runsOptions.queryKey });
		onChanged?.();
	};

	const verifyMutation = useMutation(
		trpc.backup.verify.mutationOptions({
			onSuccess: (result) => {
				toast.success(`Restore verified: ${result.key.split("/").pop()} restores cleanly`);
				invalidate();
			},
			onError: (error) => {
				toast.error(`Restore verification failed: ${describeError(error)}`);
				invalidate();
			},
		}),
	);

	const verifyHint = canManage ? undefined : capabilityHint("backups.manage");

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Run history"
				title="Run history"
				onClick={() => setOpen(true)}
			>
				<History className="size-4" />
			</Button>
			<SheetContent
				side="right"
				className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-3xl"
			>
				<SheetHeader>
					<SheetTitle>Run history</SheetTitle>
					<SheetDescription>
						Last {RUNS_LIMIT} runs of {title}.
						{kind === "backup" &&
							" Verify restores a dump into a throwaway container of the same image and runs a liveness query; the live database is never touched."}
					</SheetDescription>
				</SheetHeader>
				<div className="px-4 pb-4">
					<QueryState
						isPending={runsQuery.isPending}
						isError={runsQuery.isError}
						error={runsQuery.error}
						onRetry={() => void runsQuery.refetch()}
						isEmpty={runs.length === 0}
						skeleton={
							<div className="space-y-2">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
							</div>
						}
						empty={
							<EmptyState
								icon={History}
								title="No runs yet"
								description="Runs appear here once the schedule fires or you run the backup manually."
							/>
						}
					>
						<div className="overflow-x-auto rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Status</TableHead>
										<TableHead>Trigger</TableHead>
										<TableHead>Started</TableHead>
										<TableHead>Duration</TableHead>
										<TableHead>Size</TableHead>
										<TableHead>Object</TableHead>
										{kind === "backup" && <TableHead className="text-right">Actions</TableHead>}
									</TableRow>
								</TableHeader>
								<TableBody>
									{view.visible.map((run) => {
										const verifying =
											verifyMutation.isPending && verifyMutation.variables?.key === run.objectKey;
										const verifiable =
											kind === "backup" &&
											run.status === "success" &&
											run.trigger !== "verify" &&
											!!run.objectKey;
										return (
											<TableRow key={run.backupRunId}>
												<TableCell>
													<div className="flex flex-col gap-1">
														<StatusBadge status={run.status} error={run.error} />
														{run.error && (
															<p
																className="max-w-64 truncate text-xs text-destructive"
																title={run.error}
															>
																{run.error}
															</p>
														)}
													</div>
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{TRIGGER_LABELS[run.trigger] ?? run.trigger}
												</TableCell>
												<TableCell className="whitespace-nowrap text-sm">
													<DateTime value={run.startedAt} mode="absolute" />
												</TableCell>
												<TableCell className="text-sm tabular-nums text-muted-foreground">
													{run.status === "running"
														? "…"
														: formatDuration(run.startedAt, run.finishedAt)}
												</TableCell>
												<TableCell className="text-sm tabular-nums text-muted-foreground">
													{run.bytes != null ? formatBytes(run.bytes) : "—"}
												</TableCell>
												<TableCell>
													{run.objectKey ? (
														<code
															className="block max-w-56 truncate rounded bg-muted px-1.5 py-0.5 text-xs"
															title={run.objectKey}
														>
															{run.objectKey.split("/").pop()}
														</code>
													) : (
														<span className="text-sm text-muted-foreground">—</span>
													)}
												</TableCell>
												{kind === "backup" && (
													<TableCell className="text-right">
														{verifiable && (
															<Button
																variant="outline"
																size="sm"
																disabled={!canManage || verifyMutation.isPending}
																title={
																	verifyHint ?? "Test-restore this dump in a throwaway container"
																}
																onClick={() =>
																	run.objectKey &&
																	verifyMutation.mutate({ backupId: id, key: run.objectKey })
																}
															>
																{verifying ? (
																	<Loader2 className="size-4 animate-spin" />
																) : (
																	<ShieldCheck className="size-4" />
																)}
																Verify
															</Button>
														)}
													</TableCell>
												)}
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
						<TablePagination view={view} noun="runs" className="mt-3" />
					</QueryState>
				</div>
			</SheetContent>
		</Sheet>
	);
}
