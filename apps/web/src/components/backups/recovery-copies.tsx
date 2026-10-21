"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { settleActivity, trackActivity } from "@/components/layout/activity-tray";
import { SettingsSection } from "@/components/layout/settings-section";
import { LoadError } from "@/components/query-state";
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
import { DateTime } from "@/components/ui/date-time";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { describeError, toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

const ACTIVE = new Set(["validating", "provisioning", "restoring", "verifying", "deleting"]);
const STATUS: Record<string, string> = {
	validating: "Validating archive",
	provisioning: "Starting database",
	restoring: "Restoring",
	verifying: "Verifying",
	ready: "Ready",
	error: "Needs attention",
	interrupted: "Result unavailable",
	deleting: "Deleting",
	deleted: "Deleted",
};

/** Retained copies are separate managed databases, with their own credentials and lifecycle. */
export function RecoveryCopies({
	scope,
	backups = [],
	backupsStatus = "ready",
	onRetryBackups,
}: {
	scope: { postgresId: string } | { projectId: string };
	backups?: { id: string; database: string; cron: string }[];
	backupsStatus?: "pending" | "error" | "ready";
	onRetryBackups?: () => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const pathname = usePathname();
	const serviceId = "postgresId" in scope ? scope.postgresId : undefined;
	const href =
		"projectId" in scope
			? `/dashboard/projects/${scope.projectId}?tab=recovery-copies`
			: `${pathname}?tab=backups`;
	const {
		role,
		canAll,
		isLoading: permissionsLoading,
		isError: permissionsError,
	} = useCapabilities({ strict: true });
	const canCreate =
		(role === "owner" || role === "admin") &&
		canAll("backups.manage", "service.create", "service.deploy", "secrets.write");
	const canDelete =
		(role === "owner" || role === "admin") && canAll("backups.manage", "service.delete");
	const [selectedBackup, setSelectedBackup] = useState("");
	const backupId = backups.some((backup) => backup.id === selectedBackup)
		? selectedBackup
		: backups[0]?.id || "";
	const [open, setOpen] = useState(false);
	const [key, setKey] = useState("");
	const [name, setName] = useState("");
	const [environmentId, setEnvironmentId] = useState("");
	const [requestId, setRequestId] = useState("");
	const [createError, setCreateError] = useState<string | null>(null);
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [cursors, setCursors] = useState<({ createdAt: string; id: string } | undefined)[]>([
		undefined,
	]);
	const cursor = cursors[cursors.length - 1];
	const fieldId = useId();
	const source = useQuery({
		...trpc.postgres.one.queryOptions({ postgresId: serviceId ?? "" }),
		enabled: !!serviceId,
	});
	const projects = useQuery({ ...trpc.project.all.queryOptions(), enabled: open });
	const keys = useQuery({
		...trpc.backup.listBackups.queryOptions({ backupId }),
		enabled: open && !!backupId,
	});
	const copies = useQuery(
		trpc.backup.copyInventory.queryOptions({ ...scope, ...(cursor ? { cursor } : {}) }),
	);
	const copyRows = copies.data?.items;
	const nextCursor = copies.data?.nextCursor;
	const create = useMutation(trpc.backup.createCopy.mutationOptions());
	const remove = useMutation(trpc.backup.deleteCopy.mutationOptions());
	const targets = (projects.data ?? []).flatMap((project) =>
		project.environments
			.filter((environment) => environment.environmentId !== source.data?.environmentId)
			.map((environment) => ({
				id: environment.environmentId,
				label: `${project.name} / ${environment.name}`,
			})),
	);
	const deletion = copyRows?.find((row) => row.recoveryCopyId === deleteId);
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.backup.copies.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.backup.copyInventory.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.project.all.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.project.one.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.postgres.all.queryKey() }),
		]);
	const canSubmit =
		!!backupId &&
		!!name.trim() &&
		canCreate &&
		keys.isSuccess &&
		keys.data.includes(key) &&
		projects.isSuccess &&
		!source.isPending &&
		!source.isError &&
		targets.some((target) => target.id === environmentId) &&
		!create.isPending;
	const openForm = () => {
		setCreateError(null);
		setKey("");
		setName("Recovery copy");
		setEnvironmentId("");
		setRequestId(crypto.randomUUID());
		setOpen(true);
	};
	// Await the mutation so tray completion still runs after navigating away.
	const submit = async () => {
		if (!canSubmit) return;
		setCreateError(null);
		const activity = trackActivity({
			id: `recovery-copy:${requestId}`,
			kind: "clone",
			label: `Create ${name.trim()}`,
			detail: "Validate archive → restore → verify",
			href,
		});
		try {
			const result = await create.mutateAsync({
				backupId,
				key,
				name: name.trim(),
				environmentId,
				requestId,
			});
			setCursors([undefined]);
			settleActivity(
				activity,
				result.status === "ready" ? "done" : "error",
				result.status === "ready" ? "Private copy verified" : "Review recovery history",
			);
			void refresh();
			if (result.status === "ready") {
				toast.success("Recovery copy ready");
				setOpen(false);
			} else {
				// A definite failure is a finished attempt. Network errors retain the old request ID.
				if (result.status === "error") setRequestId(crypto.randomUUID());
				const message =
					result.error ??
					"The copy is still running. Refresh its history to check the result before retrying.";
				setCreateError(message);
				toastError(new Error(message), "Recovery copy needs attention");
			}
		} catch (error) {
			setCursors([undefined]);
			setCreateError(describeError(error));
			settleActivity(activity, "error", "Refresh recovery history before retrying");
			void refresh();
			toastError(error, "Recovery request failed");
		}
	};
	const confirmDelete = async () => {
		if (
			!deleteId ||
			!canDelete ||
			!deletion ||
			ACTIVE.has(deletion.status) ||
			deletion.status === "deleted"
		)
			return;
		setDeleteError(null);
		const activity = trackActivity({
			id: `delete-copy:${deleteId}`,
			kind: "clone",
			label: `Delete ${deletion.name}`,
			href,
		});
		try {
			await remove.mutateAsync({ recoveryCopyId: deleteId });
			settleActivity(activity, "done");
			setDeleteId(null);
			void refresh();
			toast.success("Recovery copy deleted");
		} catch (error) {
			settleActivity(activity, "error");
			void refresh();
			setDeleteError(describeError(error));
			toastError(error, "Deletion failed");
		}
	};
	return (
		<SettingsSection
			wide
			title="Recovery copies"
			description={
				serviceId
					? "Restore a PostgreSQL dump into a separate private environment for investigation or development. Copies keep the original data and stay until you delete them."
					: "Retained PostgreSQL recovery databases across this project. Copies stay until you delete them, even after their backup schedule is removed."
			}
			actions={
				serviceId ? (
					<Button
						size="sm"
						variant="outline"
						disabled={
							backupsStatus !== "ready" ||
							!backupId ||
							!canCreate ||
							source.isPending ||
							source.isError ||
							create.isPending
						}
						title={
							!canCreate
								? "An organization admin with backup, deployment and secret permissions is required"
								: undefined
						}
						onClick={openForm}
					>
						<Copy className="size-4" />
						Create copy
					</Button>
				) : undefined
			}
		>
			{permissionsError ? (
				<div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm">
					<p>Copy permissions could not be checked.</p>
					<Button
						size="sm"
						variant="outline"
						onClick={() =>
							queryClient.refetchQueries({ queryKey: trpc.organization.myCapabilities.queryKey() })
						}
					>
						Retry permissions
					</Button>
				</div>
			) : !permissionsLoading && !canDelete ? (
				<p className="text-sm text-muted-foreground">
					Deleting copies requires an organization admin with backup and service deletion
					permissions.
				</p>
			) : null}
			{serviceId &&
				(backupsStatus === "pending" ? (
					<p role="status" className="text-sm text-muted-foreground">
						Loading backup schedules…
					</p>
				) : backupsStatus === "error" ? (
					<div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm">
						<p>Backup schedules could not be loaded. Retained copies are listed below.</p>
						{onRetryBackups && (
							<Button size="sm" variant="outline" onClick={onRetryBackups}>
								Retry schedules
							</Button>
						)}
					</div>
				) : !backupId ? (
					<p className="text-sm text-muted-foreground">
						Create a backup schedule and run a dump to make a new recovery copy. Retained copies are
						listed below.
					</p>
				) : source.isError ? (
					<div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm">
						<p>The source database could not be loaded for a new copy.</p>
						<Button size="sm" variant="outline" onClick={() => source.refetch()}>
							Retry source
						</Button>
					</div>
				) : !permissionsLoading && !canCreate ? (
					<p className="text-sm text-muted-foreground">
						Creating copies requires an organization admin with backup, deployment and secret
						permissions.
					</p>
				) : null)}
			{copies.isPending ? <Skeleton className="h-20 w-full" /> : null}
			{copies.isError && (
				<LoadError
					title="Could not load recovery copies"
					message={describeError(copies.error)}
					onRetry={() => void copies.refetch()}
				/>
			)}
			{copyRows && (
				<div className="space-y-3">
					<div className="flex items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">Private network · Fresh credentials</p>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => copies.refetch()}
							disabled={copies.isFetching}
						>
							<RefreshCw className={`size-3.5 ${copies.isFetching ? "animate-spin" : ""}`} />
							Refresh
						</Button>
					</div>
					{copyRows.length === 0 && !copies.isError ? (
						<p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
							{cursors.length > 1
								? "No copies remain on this page. Go to newer copies to continue."
								: serviceId
									? "No recovery copies for this database. Create one from a stored PostgreSQL dump."
									: "No recovery copies in this project. Open a PostgreSQL service’s Backups tab to create one from a stored dump."}
						</p>
					) : copyRows.length > 0 ? (
						<ul className="surface divide-y">
							{copyRows.map((row) => (
								<li
									key={row.recoveryCopyId}
									className="relative flex flex-wrap items-start gap-4 border-s-2 border-s-muted-foreground/40 px-5 py-5"
								>
									<div className="min-w-0 flex-1 basis-52">
										<div className="flex flex-wrap items-center gap-2">
											<p className="break-words text-sm font-medium">{row.name}</p>
											<Badge
												variant={
													row.status === "error" || row.status === "interrupted"
														? "destructive"
														: "outline"
												}
											>
												{STATUS[row.status] ?? "Unknown"}
											</Badge>
										</div>
										<p className="mt-1 text-xs text-muted-foreground">
											{row.targetEnvironmentName} · <DateTime value={row.createdAt} />
											{row.status === "ready" &&
												` · ${row.tableCount ?? 0} ${row.tableCount === 1 ? "table" : "tables"} verified`}
										</p>
										<p
											className="mt-3 rounded-md bg-panel-inset px-3 py-2 font-mono text-xs break-all text-muted-foreground"
											title={row.objectKey}
										>
											{row.objectKey}
										</p>
										{row.error && (
											<p className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
												{row.error}
											</p>
										)}
										{!row.backupId && (
											<p className="mt-1 text-xs text-muted-foreground">Backup schedule removed</p>
										)}
										{row.status === "interrupted" && (
											<p className="mt-2 text-sm text-muted-foreground">
												{row.targetPostgresId
													? "The operation did not report a result. Inspect the retained database or delete this copy."
													: "The database record is unavailable. Delete this copy to verify cleanup at its recorded origin."}
											</p>
										)}
									</div>
									<div className="flex shrink-0 items-center gap-2 border-s ps-4">
										{row.targetPostgresId && (
											<Button asChild size="sm" variant="outline">
												<Link
													href={`/dashboard/projects/${row.projectId}/services/postgres/${row.targetPostgresId}?tab=connection`}
												>
													Open database
													<ArrowUpRight className="size-3.5" />
												</Link>
											</Button>
										)}
										{row.status !== "deleted" && (
											<Button
												size="icon-sm"
												variant="ghost"
												aria-label={`Delete ${row.name}`}
												title={
													!canDelete
														? "An organization admin with backup and service deletion permissions is required"
														: ACTIVE.has(row.status)
															? "Wait for the current copy operation to finish"
															: `Delete ${row.name}`
												}
												disabled={!canDelete || ACTIVE.has(row.status) || remove.isPending}
												onClick={() => {
													setDeleteError(null);
													setDeleteId(row.recoveryCopyId);
												}}
											>
												<Trash2 className="size-4" />
											</Button>
										)}
									</div>
								</li>
							))}
						</ul>
					) : null}
				</div>
			)}
			{(cursors.length > 1 || nextCursor) && (
				<nav
					aria-label="Recovery copy pages"
					className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
				>
					<p className="text-sm text-muted-foreground">
						Page <span className="font-mono tabular-nums">{cursors.length}</span>
					</p>
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={cursors.length === 1 || copies.isFetching || remove.isPending}
							onClick={() => setCursors((current) => current.slice(0, -1))}
						>
							Newer copies
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={!nextCursor || copies.isFetching || remove.isPending}
							onClick={() => {
								if (nextCursor) setCursors((current) => [...current, nextCursor]);
							}}
						>
							Older copies
						</Button>
					</div>
				</nav>
			)}
			{serviceId && (
				<Dialog
					open={open}
					onOpenChange={(value) => {
						if (!create.isPending) setOpen(value);
					}}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create recovery copy</DialogTitle>
							<DialogDescription>
								A new PostgreSQL service uses the source image and server, with fresh credentials
								and no published port. The copied data is not sanitized. The source is preserved.
								Creation has a 10 minute timeout. Verified copies stay until you delete them.
							</DialogDescription>
						</DialogHeader>
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								void submit();
							}}
						>
							{backups.length > 1 && (
								<div className="space-y-2">
									<Label htmlFor={`${fieldId}-backup`}>Backup schedule</Label>
									<Select
										value={backupId}
										onValueChange={(value) => {
											setSelectedBackup(value);
											setKey("");
										}}
										disabled={create.isPending}
									>
										<SelectTrigger id={`${fieldId}-backup`} className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{backups.map((backup) => (
												<SelectItem key={backup.id} value={backup.id}>
													{backup.database} · {backup.cron}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
							<div className="space-y-2">
								<Label htmlFor={`${fieldId}-key`}>Stored dump</Label>
								{keys.isError ? (
									<Button type="button" variant="outline" onClick={() => keys.refetch()}>
										Retry dump list
									</Button>
								) : keys.isPending ? (
									<Skeleton className="h-9" />
								) : (
									<>
										<Select value={key} onValueChange={setKey} disabled={create.isPending}>
											<SelectTrigger id={`${fieldId}-key`} className="w-full">
												<SelectValue placeholder="Choose a dump" />
											</SelectTrigger>
											<SelectContent>
												{keys.data?.map((dump) => (
													<SelectItem key={dump} value={dump}>
														{dump}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										{keys.data?.length === 0 && (
											<p className="text-sm text-muted-foreground">
												Run this backup schedule first. There are no stored dumps.
											</p>
										)}
									</>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor={`${fieldId}-name`}>Copy name</Label>
								<Input
									id={`${fieldId}-name`}
									value={name}
									onChange={(event) => setName(event.target.value)}
									maxLength={200}
									required
									disabled={create.isPending}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor={`${fieldId}-environment`}>Target environment</Label>
								{projects.isError || source.isError ? (
									<Button
										type="button"
										variant="outline"
										onClick={() => {
											void projects.refetch();
											void source.refetch();
										}}
									>
										Retry environments
									</Button>
								) : projects.isPending ? (
									<Skeleton className="h-9" />
								) : (
									<>
										<Select
											value={environmentId}
											onValueChange={setEnvironmentId}
											disabled={create.isPending}
										>
											<SelectTrigger id={`${fieldId}-environment`} className="w-full">
												<SelectValue placeholder="Choose another environment" />
											</SelectTrigger>
											<SelectContent>
												{targets.map((target) => (
													<SelectItem key={target.id} value={target.id}>
														{target.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										{targets.length === 0 && (
											<p className="text-sm text-muted-foreground">
												Add another environment in your project before creating a copy.
											</p>
										)}
									</>
								)}
							</div>
							{create.isPending && (
								<p role="status" className="text-sm">
									Validating, restoring and verifying the new database. This can take up to ten
									minutes.
								</p>
							)}
							{createError && (
								<p role="alert" className="text-sm text-destructive">
									{createError}
								</p>
							)}
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									disabled={create.isPending}
									onClick={() => setOpen(false)}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={!canSubmit}>
									{create.isPending && <Loader2 className="size-4 animate-spin" />}Create private
									copy
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			)}
			<AlertDialog
				open={deleteId !== null}
				onOpenChange={(value) => {
					if (!value && !remove.isPending) setDeleteId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete recovery copy?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes {deletion?.name ?? "the recovery database"} and its data
							volume. The source database and stored dump are preserved.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteError && (
						<p role="alert" className="text-sm text-destructive">
							{deleteError}
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								remove.isPending ||
								!deleteId ||
								!canDelete ||
								!deletion ||
								ACTIVE.has(deletion.status) ||
								deletion.status === "deleted"
							}
							onClick={(event) => {
								event.preventDefault();
								void confirmDelete();
							}}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}Delete copy
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsSection>
	);
}
