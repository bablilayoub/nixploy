"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import {
	ArchiveRestore,
	DatabaseBackup,
	Loader2,
	Pencil,
	Play,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	BackupRunsSheet,
	LastRunBadge,
	type LastRunSummary,
} from "@/components/backups/backup-runs";
import type { BackupDatabaseType } from "@/components/databases/database-types";
import {
	settleActivity,
	trackActivity,
	useTrackedActivity,
} from "@/components/layout/activity-tray";
import { SettingsSection } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
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
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DatabaseBackupEntry = RouterOutputs["backup"]["all"][number];
type VolumeBackupEntry = RouterOutputs["volumeBackup"]["all"][number];

/**
 * What the panel backs up: a database dump (`backup` router) or a docker
 * volume archive (`volumeBackup` router).
 */
export type BackupsTarget =
	| {
			kind: "database";
			databaseType: BackupDatabaseType;
			serviceId: string;
			/** Default database name to dump (prefills the create form). */
			databaseName: string;
	  }
	| { kind: "volume"; serviceType: "application" | "compose"; serviceId: string };

/** One scheduled backup, normalised across the two routers. */
interface BackupEntry {
	id: string;
	name: string;
	volumeName: string;
	database: string;
	cron: string;
	prefix: string;
	keepLatestCount: number | null;
	destinationId: string;
	enabled: boolean;
	lastRun: LastRunSummary | null | undefined;
	createdAt: Date | string;
}

interface BackupFormState {
	name: string;
	volumeName: string;
	database: string;
	cron: string;
	prefix: string;
	keepLatestCount: string;
	destinationId: string;
	enabled: boolean;
}

const CRON_PRESETS = [
	{ label: "Every hour", value: "0 * * * *" },
	{ label: "Every 6 hours", value: "0 */6 * * *" },
	{ label: "Every day at midnight", value: "0 0 * * *" },
	{ label: "Every week (Sunday)", value: "0 0 * * 0" },
] as const;

/** Cheap 5/6-field cron sanity check; the server does the authoritative validation. */
function looksLikeCron(expression: string): boolean {
	const fields = expression.trim().split(/\s+/);
	return fields.length === 5 || fields.length === 6;
}

function emptyForm(target: BackupsTarget): BackupFormState {
	return target.kind === "database"
		? {
				name: "",
				volumeName: "",
				database: target.databaseName,
				cron: "0 3 * * *",
				prefix: "backup",
				keepLatestCount: "",
				destinationId: "",
				enabled: true,
			}
		: {
				name: "",
				volumeName: "",
				database: "",
				cron: "0 0 * * *",
				prefix: "volume-backup",
				keepLatestCount: "",
				destinationId: "",
				enabled: true,
			};
}

function fromDatabaseRow(row: DatabaseBackupEntry): BackupEntry {
	return {
		id: row.backupId,
		name: row.database,
		volumeName: "",
		database: row.database,
		cron: row.schedule,
		prefix: row.prefix,
		keepLatestCount: row.keepLatestCount,
		destinationId: row.destinationId,
		enabled: row.enabled,
		lastRun: row.lastRun,
		createdAt: row.createdAt,
	};
}

function fromVolumeRow(row: VolumeBackupEntry): BackupEntry {
	return {
		id: row.volumeBackupId,
		name: row.name,
		volumeName: row.volumeName,
		database: "",
		cron: row.cronExpression,
		prefix: row.prefix,
		keepLatestCount: row.keepLatestCount,
		destinationId: row.destinationId,
		enabled: row.enabled,
		lastRun: row.lastRun,
		createdAt: row.createdAt,
	};
}

/**
 * Scheduled backups for one service, in both flavours (code-health F4: this
 * replaces `databases/database-backups.tsx` and `backups/volume-backups-tab.tsx`,
 * which shared 76% of their identifiers).
 *
 * Shared here: the section frame and capability gate, the destinations lookup,
 * the run-history sheet, the last-run badge, the verify button (both live in
 * `backup-runs.tsx`), run-now with tray tracking, the enable switch, the
 * restore dialog and the delete confirmation. Per target: which router is
 * called, the table columns and the extra form fields.
 */
export function BackupsPanel({ target }: { target: BackupsTarget }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const backupsHref = `${pathname}?tab=backups`;
	const { can } = useCapabilities();
	const canManage = can("backups.manage");
	const manageHint = canManage ? undefined : capabilityHint("backups.manage");
	const isVolume = target.kind === "volume";

	// Both procedures are always registered; `enabled` decides which one runs.
	const databaseInput = {
		serviceId: target.serviceId,
		databaseType: target.kind === "database" ? target.databaseType : ("postgres" as const),
	};
	const volumeInput = {
		serviceId: target.serviceId,
		serviceType: target.kind === "volume" ? target.serviceType : ("application" as const),
	};
	const databaseQuery = useQuery({
		...trpc.backup.all.queryOptions(databaseInput),
		enabled: !isVolume,
	});
	const volumeQuery = useQuery({
		...trpc.volumeBackup.all.queryOptions(volumeInput),
		enabled: isVolume,
	});
	const listQuery = isVolume ? volumeQuery : databaseQuery;
	const backups: BackupEntry[] = isVolume
		? (volumeQuery.data ?? []).map(fromVolumeRow)
		: (databaseQuery.data ?? []).map(fromDatabaseRow);
	const listKey = isVolume
		? trpc.volumeBackup.all.queryKey(volumeInput)
		: trpc.backup.all.queryKey(databaseInput);

	const destinationsQuery = useQuery(trpc.destination.all.queryOptions());
	const destinations = destinationsQuery.data;
	const destinationName = (destinationId: string) =>
		destinations?.find((destination) => destination.destinationId === destinationId)?.name ??
		"Unknown";

	const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<BackupEntry | null>(null);
	const [form, setForm] = useState<BackupFormState>(() => emptyForm(target));
	const [deleteTarget, setDeleteTarget] = useState<BackupEntry | null>(null);
	const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);
	const [restoreKey, setRestoreKey] = useState("");

	useEffect(() => {
		if (!dialogOpen) setEditing(null);
	}, [dialogOpen]);

	// ---- mutations -------------------------------------------------------

	const createDatabase = useMutation(trpc.backup.create.mutationOptions());
	const createVolume = useMutation(trpc.volumeBackup.create.mutationOptions());
	const updateDatabase = useMutation(trpc.backup.update.mutationOptions());
	const updateVolume = useMutation(trpc.volumeBackup.update.mutationOptions());
	const removeDatabase = useMutation(trpc.backup.remove.mutationOptions());
	const removeVolume = useMutation(trpc.volumeBackup.remove.mutationOptions());
	const runDatabase = useMutation(trpc.backup.runManually.mutationOptions());
	const runVolume = useMutation(trpc.volumeBackup.runManually.mutationOptions());
	const restoreDatabase = useMutation(trpc.backup.restore.mutationOptions());
	const restoreVolume = useMutation(trpc.volumeBackup.restore.mutationOptions());

	const create = isVolume ? createVolume : createDatabase;
	const update = isVolume ? updateVolume : updateDatabase;
	const remove = isVolume ? removeVolume : removeDatabase;
	const run = isVolume ? runVolume : runDatabase;
	const restore = isVolume ? restoreVolume : restoreDatabase;
	const saving = create.isPending || update.isPending;

	const runningId = isVolume
		? runVolume.variables?.volumeBackupId
		: runDatabase.variables?.backupId;

	// Dumping or archiving can take minutes; the tray keeps it visible off this
	// page (UX audit F14).
	useTrackedActivity({
		active: run.isPending,
		id: `${isVolume ? "volume-backup" : "backup"}:${runningId ?? "run"}`,
		kind: "backup",
		label: isVolume ? "Volume backup running" : "Backup running",
		detail: isVolume ? "Archiving to S3" : "Dumping to S3",
		href: backupsHref,
	});
	useTrackedActivity({
		active: isVolume && restoreVolume.isPending,
		id: `volume-restore:${restoreVolume.variables?.volumeBackupId ?? "restore"}`,
		kind: "restore",
		label: "Volume restore running",
		detail: restoreTarget?.volumeName,
		href: backupsHref,
	});

	const toggleEnabled = (entry: BackupEntry, enabled: boolean) => {
		if (isVolume) {
			updateVolume.mutate(
				{ volumeBackupId: entry.id, enabled },
				{ onSuccess: () => invalidate(), onError: (error) => toastError(error) },
			);
			return;
		}
		updateDatabase.mutate(
			{ backupId: entry.id, enabled },
			{
				onSuccess: () => {
					toast.success("Backup updated");
					invalidate();
				},
				onError: (error) => toastError(error),
			},
		);
	};

	const runNow = (entry: BackupEntry) => {
		const onSettled = () => invalidate();
		if (isVolume) {
			runVolume.mutate(
				{ volumeBackupId: entry.id },
				{
					onSuccess: () => {
						toast.success("Backup uploaded", {
							action: { label: "View", onClick: () => router.push(backupsHref) },
						});
						onSettled();
					},
					// The server answers BAD_REQUEST "already running" while a run is
					// in flight — its message is already user-facing.
					onError: (error) => {
						toastError(error);
						onSettled();
					},
				},
			);
			return;
		}
		runDatabase.mutate(
			{ backupId: entry.id },
			{
				// The server answers once the dump is stored — the run row is final.
				onSuccess: () => {
					toast.success("Backup finished", {
						action: { label: "View", onClick: () => router.push(backupsHref) },
					});
					onSettled();
				},
				onError: (error) => {
					toastError(error);
					onSettled();
				},
			},
		);
	};

	const confirmDelete = () => {
		if (!deleteTarget) return;
		const done = () => {
			toast.success(isVolume ? "Volume backup deleted" : "Backup deleted");
			setDeleteTarget(null);
			invalidate();
		};
		if (isVolume) {
			removeVolume.mutate(
				{ volumeBackupId: deleteTarget.id },
				{ onSuccess: done, onError: (error) => toastError(error) },
			);
		} else {
			removeDatabase.mutate(
				{ backupId: deleteTarget.id },
				{ onSuccess: done, onError: (error) => toastError(error) },
			);
		}
	};

	// ---- form ------------------------------------------------------------

	const keepLatest = form.keepLatestCount.trim();
	const keepLatestValue = keepLatest === "" ? null : Number(keepLatest);
	const keepValid =
		keepLatestValue === null || (Number.isInteger(keepLatestValue) && keepLatestValue >= 1);
	const isValid =
		form.destinationId !== "" &&
		keepValid &&
		(isVolume
			? form.name.trim() !== "" && form.volumeName.trim() !== "" && looksLikeCron(form.cron)
			: form.cron.trim() !== "" && form.prefix.trim() !== "" && form.database.trim() !== "");
	const presetValue = CRON_PRESETS.some((preset) => preset.value === form.cron)
		? form.cron
		: "custom";

	const openCreate = () => {
		setEditing(null);
		setForm(emptyForm(target));
		setDialogOpen(true);
	};

	const openEdit = (entry: BackupEntry) => {
		setEditing(entry);
		setForm({
			name: entry.name,
			volumeName: entry.volumeName,
			database: entry.database,
			cron: entry.cron,
			prefix: entry.prefix,
			keepLatestCount: entry.keepLatestCount?.toString() ?? "",
			destinationId: entry.destinationId,
			enabled: entry.enabled,
		});
		setDialogOpen(true);
	};

	const onSubmit = () => {
		const close = () => {
			invalidate();
			setDialogOpen(false);
		};
		const onError = (error: unknown) => toastError(error, "Something went wrong");
		if (isVolume) {
			const base = {
				name: form.name,
				volumeName: form.volumeName,
				cronExpression: form.cron,
				prefix: form.prefix || undefined,
				keepLatestCount: keepLatestValue,
				destinationId: form.destinationId,
			};
			if (editing) {
				updateVolume.mutate(
					{ volumeBackupId: editing.id, ...base },
					{
						onSuccess: () => {
							toast.success("Volume backup updated");
							close();
						},
						onError,
					},
				);
			} else {
				createVolume.mutate(
					{
						...base,
						serviceType: volumeInput.serviceType,
						serviceId: target.serviceId,
						enabled: form.enabled,
					},
					{
						onSuccess: () => {
							toast.success("Volume backup created");
							close();
						},
						onError,
					},
				);
			}
			return;
		}
		const base = {
			schedule: form.cron.trim(),
			enabled: form.enabled,
			prefix: form.prefix.trim(),
			database: form.database.trim(),
			keepLatestCount: keepLatestValue,
			destinationId: form.destinationId,
		};
		if (editing) {
			updateDatabase.mutate(
				{ backupId: editing.id, ...base },
				{
					onSuccess: () => {
						toast.success("Backup updated");
						close();
					},
					onError,
				},
			);
		} else {
			createDatabase.mutate(
				{ ...base, databaseType: databaseInput.databaseType, serviceId: target.serviceId },
				{
					onSuccess: () => {
						toast.success("Backup created");
						close();
					},
					onError,
				},
			);
		}
	};

	// ---- restore ---------------------------------------------------------

	const restoreKeysQuery = useQuery({
		...(isVolume
			? trpc.volumeBackup.listBackups.queryOptions({ volumeBackupId: restoreTarget?.id ?? "" })
			: trpc.backup.listBackups.queryOptions({ backupId: restoreTarget?.id ?? "" })),
		enabled: restoreTarget !== null,
	});
	const restoreKeys = restoreKeysQuery.data ?? [];

	const submitRestore = () => {
		if (!restoreTarget) return;
		if (isVolume) {
			restoreVolume.mutate(
				{ volumeBackupId: restoreTarget.id, key: restoreKey },
				{
					onSuccess: () => {
						toast.success("Volume restored", {
							action: { label: "View", onClick: () => router.push(backupsHref) },
						});
						setRestoreTarget(null);
					},
					onError: (error) => toastError(error, "Restore failed"),
				},
			);
			return;
		}
		const backupId = restoreTarget.id;
		restoreDatabase.mutate(
			{ backupId, key: restoreKey },
			{
				onSuccess: () => {
					// The server only acknowledges the start, so the tray row is
					// cleared on a timer rather than by a completion signal.
					const activityId = trackActivity({
						id: `restore:${backupId}`,
						kind: "restore",
						label: "Restore started",
						detail: restoreKey || undefined,
						href: backupsHref,
					});
					window.setTimeout(
						() => settleActivity(activityId, "done", "Check the run history"),
						2_000,
					);
					toast.success("Restore started", {
						action: { label: "View", onClick: () => router.push(backupsHref) },
					});
					setRestoreTarget(null);
				},
				onError: (error) => toastError(error, "Restore failed"),
			},
		);
	};

	// ---- rendering -------------------------------------------------------

	const noDestinations = destinations !== undefined && destinations.length === 0;

	const columns: { head: string; className?: string; cell: (entry: BackupEntry) => ReactNode }[] =
		isVolume
			? [
					{
						head: "Name",
						className: "max-w-40 truncate font-medium",
						cell: (entry) => entry.name,
					},
					{
						head: "Volume",
						className: "max-w-40 truncate font-mono text-xs",
						cell: (entry) => entry.volumeName,
					},
					{ head: "Schedule", className: "font-mono text-xs", cell: (entry) => entry.cron },
					{
						head: "Destination",
						className: "text-muted-foreground",
						cell: (entry) => destinationName(entry.destinationId),
					},
				]
			: [
					{
						head: "Schedule",
						cell: (entry) => (
							<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{entry.cron}</code>
						),
					},
					{
						head: "Destination",
						cell: (entry) => (
							<Badge variant="outline">{destinationName(entry.destinationId)}</Badge>
						),
					},
					{ head: "Prefix", className: "font-mono text-xs", cell: (entry) => entry.prefix },
				];

	const trailingColumns: { head: string; cell: (entry: BackupEntry) => ReactNode }[] = isVolume
		? []
		: [
				{
					head: "Created",
					cell: (entry) => <DateTime value={entry.createdAt} mode="absolute" />,
				},
			];

	const table = (
		<QueryState
			// A failed destinations fetch would otherwise render every row as "Unknown".
			isPending={listQuery.isPending || destinationsQuery.isPending}
			isError={listQuery.isError || destinationsQuery.isError}
			error={listQuery.error ?? destinationsQuery.error}
			onRetry={() => {
				void listQuery.refetch();
				void destinationsQuery.refetch();
			}}
			isEmpty={backups.length === 0}
			skeleton={
				<div className="flex flex-col gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			}
			empty={
				isVolume ? (
					<EmptyState
						icon={DatabaseBackup}
						title="No volume backups"
						description="Schedule a volume archive to an S3 destination."
					/>
				) : (
					<EmptyState
						icon={DatabaseBackup}
						title="No backups yet"
						description="Create a scheduled backup to protect this database."
					/>
				)
			}
		>
			<Table>
				<TableHeader>
					<TableRow>
						{columns.map((column) => (
							<TableHead key={column.head}>{column.head}</TableHead>
						))}
						<TableHead>Enabled</TableHead>
						<TableHead>Last run</TableHead>
						{trailingColumns.map((column) => (
							<TableHead key={column.head}>{column.head}</TableHead>
						))}
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{backups.map((entry) => (
						<TableRow key={entry.id}>
							{columns.map((column) => (
								<TableCell key={column.head} className={column.className}>
									{column.cell(entry)}
								</TableCell>
							))}
							<TableCell>
								<Switch
									checked={entry.enabled}
									disabled={update.isPending || !canManage}
									title={manageHint}
									onCheckedChange={(enabled) => toggleEnabled(entry, enabled)}
								/>
							</TableCell>
							<TableCell>
								<LastRunBadge run={entry.lastRun} />
							</TableCell>
							{trailingColumns.map((column) => (
								<TableCell key={column.head} className="text-sm text-muted-foreground">
									{column.cell(entry)}
								</TableCell>
							))}
							<TableCell className="text-right">
								<div className="flex items-center justify-end gap-1">
									<BackupRunsSheet
										kind={isVolume ? "volumeBackup" : "backup"}
										id={entry.id}
										title={isVolume ? entry.name : `the ${entry.database} dump (${entry.cron})`}
										canManage={canManage}
										onChanged={invalidate}
									/>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={isVolume ? "Back up now" : "Run backup now"}
										title={manageHint ?? (isVolume ? "Back up now" : "Run now")}
										disabled={run.isPending || !canManage}
										onClick={() => runNow(entry)}
									>
										{run.isPending && runningId === entry.id ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<Play className="size-4" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={isVolume ? "Restore volume backup" : "Restore backup"}
										title={manageHint ?? "Restore"}
										disabled={!canManage}
										onClick={() => {
											setRestoreKey("");
											setRestoreTarget(entry);
										}}
									>
										{isVolume ? (
											<ArchiveRestore className="size-4" />
										) : (
											<RotateCcw className="size-4" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={isVolume ? "Edit volume backup" : "Edit backup"}
										title={manageHint ?? "Edit"}
										disabled={!canManage}
										onClick={() => openEdit(entry)}
									>
										<Pencil className="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={isVolume ? "Delete volume backup" : "Delete backup"}
										title={manageHint ?? "Delete"}
										disabled={!canManage}
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
		</QueryState>
	);

	return (
		<>
			<SettingsSection
				wide
				title={isVolume ? "Volume backups" : "Backups"}
				description={
					isVolume
						? "Volume archives to a backup destination on a cron."
						: "Scheduled dumps stored in a backup destination (S3 or local disk). Restore from any stored dump, or verify one in a throwaway container."
				}
				actions={
					<Button
						size="sm"
						onClick={openCreate}
						disabled={noDestinations || !canManage}
						title={manageHint}
					>
						<Plus className="size-4" />
						{isVolume ? "Add backup" : "Create backup"}
					</Button>
				}
			>
				{noDestinations ? (
					<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
						<DatabaseBackup className="size-8 text-muted-foreground" />
						<p className="text-sm font-medium">No backup storage configured</p>
						<p className="text-sm text-muted-foreground">
							Backups need somewhere to go — an S3 bucket or a directory on this host.
						</p>
						{/* The empty state is the one place that knows what is missing, so it
						    carries the button rather than only naming the page. */}
						<Button asChild size="sm" variant="outline" className="mt-2">
							<Link href="/dashboard/settings/destinations">Add backup storage</Link>
						</Button>
					</div>
				) : (
					table
				)}
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{editing
								? isVolume
									? "Edit volume backup"
									: "Edit backup"
								: isVolume
									? "Add volume backup"
									: "Create backup"}
						</DialogTitle>
						<DialogDescription>
							{isVolume
								? "The volume is archived as a tarball and uploaded to the destination."
								: "Schedule a recurring database dump to an S3 destination."}
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							onSubmit();
						}}
					>
						{isVolume && (
							<>
								<div className="flex flex-col gap-2">
									<Label htmlFor="backup-name">Name</Label>
									<Input
										id="backup-name"
										placeholder="Nightly data backup"
										value={form.name}
										onChange={(event) => setForm({ ...form, name: event.target.value })}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="backup-volume">Volume name</Label>
									<Input
										id="backup-volume"
										className="font-mono text-sm"
										placeholder="my-app-data"
										value={form.volumeName}
										onChange={(event) => setForm({ ...form, volumeName: event.target.value })}
									/>
								</div>
							</>
						)}
						<div className="flex flex-col gap-2">
							<Label htmlFor="backup-cron">
								{isVolume ? "Cron expression (UTC)" : "Schedule (cron, UTC)"}
							</Label>
							{isVolume && (
								<Select
									value={presetValue}
									onValueChange={(value) => {
										if (value !== "custom") setForm({ ...form, cron: value });
									}}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{CRON_PRESETS.map((preset) => (
											<SelectItem key={preset.value} value={preset.value}>
												{preset.label}
											</SelectItem>
										))}
										<SelectItem value="custom">Custom</SelectItem>
									</SelectContent>
								</Select>
							)}
							<Input
								id="backup-cron"
								className="font-mono text-sm"
								placeholder="0 3 * * *"
								value={form.cron}
								onChange={(event) => setForm({ ...form, cron: event.target.value })}
							/>
							{isVolume ? (
								!looksLikeCron(form.cron) && (
									<p className="text-xs text-destructive">
										Expected 5 or 6 fields: [second] minute hour day month weekday.
									</p>
								)
							) : (
								<p className="text-sm text-muted-foreground">
									Examples: <code>0 3 * * *</code> daily at 3:00, <code>0 */6 * * *</code> every 6
									hours, <code>0 0 * * 0</code> weekly on Sunday. Times are UTC.
								</p>
							)}
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="backup-destination">Destination</Label>
							<Select
								value={form.destinationId}
								onValueChange={(destinationId) => setForm({ ...form, destinationId })}
							>
								<SelectTrigger id="backup-destination" className="w-full">
									<SelectValue
										placeholder={isVolume ? "Select a destination" : "Select an S3 destination"}
									/>
								</SelectTrigger>
								<SelectContent>
									{(destinations ?? []).map((destination) => (
										<SelectItem key={destination.destinationId} value={destination.destinationId}>
											{destination.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid grid-cols-2 gap-4">
							{!isVolume && (
								<div className="flex flex-col gap-2">
									<Label htmlFor="backup-database">Database</Label>
									<Input
										id="backup-database"
										className="font-mono text-sm"
										value={form.database}
										onChange={(event) => setForm({ ...form, database: event.target.value })}
									/>
								</div>
							)}
							<div className="flex flex-col gap-2">
								<Label htmlFor="backup-prefix">Prefix</Label>
								<Input
									id="backup-prefix"
									className="font-mono text-sm"
									placeholder={isVolume ? "volume-backup" : undefined}
									value={form.prefix}
									onChange={(event) => setForm({ ...form, prefix: event.target.value })}
								/>
							</div>
							{isVolume && (
								<div className="flex flex-col gap-2">
									<Label htmlFor="backup-keep">Keep latest</Label>
									<Input
										id="backup-keep"
										inputMode="numeric"
										placeholder="All"
										value={form.keepLatestCount}
										onChange={(event) => setForm({ ...form, keepLatestCount: event.target.value })}
									/>
								</div>
							)}
						</div>
						{!isVolume && (
							<div className="flex flex-col gap-2">
								<Label htmlFor="backup-keep">Keep latest count (optional)</Label>
								<Input
									id="backup-keep"
									type="number"
									min={1}
									placeholder="Keep all"
									value={form.keepLatestCount}
									onChange={(event) => setForm({ ...form, keepLatestCount: event.target.value })}
								/>
								{!keepValid && (
									<p className="text-sm text-destructive">Enter a whole number of at least 1.</p>
								)}
							</div>
						)}
						{(!editing || !isVolume) && (
							<div className="flex items-center gap-2">
								<Switch
									id="backup-enabled"
									checked={form.enabled}
									onCheckedChange={(enabled) => setForm({ ...form, enabled })}
								/>
								<Label htmlFor="backup-enabled" className="font-normal">
									Enabled
								</Label>
							</div>
						)}
						<DialogFooter>
							{isVolume ? null : (
								<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
									Cancel
								</Button>
							)}
							<Button type="submit" disabled={!isValid || saving}>
								{saving && <Loader2 className="size-4 animate-spin" />}
								{editing
									? isVolume
										? "Save"
										: "Save changes"
									: isVolume
										? "Create"
										: "Create backup"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={restoreTarget !== null}
				onOpenChange={(open) => !open && setRestoreTarget(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{isVolume ? "Restore volume" : "Restore backup"}</DialogTitle>
						<DialogDescription>
							{isVolume ? (
								<>
									Volume <code className="rounded bg-muted px-1">{restoreTarget?.volumeName}</code>{" "}
									will be overwritten with the selected archive. This cannot be undone.
								</>
							) : (
								"Restore the database from a stored dump. The current data will be overwritten."
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label htmlFor="backup-restore-key">{isVolume ? "Archive" : "Stored dump"}</Label>
						{restoreKeysQuery.isPending ? (
							<Skeleton className="h-9 w-full" />
						) : restoreKeysQuery.isError ? (
							// An S3 credential/connectivity failure must not read as "none stored".
							<div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-3">
								<p className="text-sm font-medium">
									{isVolume ? "Could not list stored archives" : "Could not list stored dumps"}
								</p>
								<p className="text-sm text-muted-foreground">{restoreKeysQuery.error.message}</p>
								<Button variant="outline" size="sm" onClick={() => restoreKeysQuery.refetch()}>
									Retry
								</Button>
							</div>
						) : restoreKeys.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{isVolume
									? "No stored archives found for this backup yet."
									: "No dumps found in the destination for this backup yet."}
							</p>
						) : (
							<Select value={restoreKey} onValueChange={setRestoreKey} disabled={restore.isPending}>
								<SelectTrigger id="backup-restore-key" className="w-full">
									<SelectValue
										placeholder={isVolume ? "Select an archive" : "Select a dump to restore"}
									/>
								</SelectTrigger>
								<SelectContent>
									{restoreKeys.map((key) => (
										<SelectItem key={key} value={key}>
											<span className="font-mono text-xs">
												{isVolume ? key.split("/").pop() : key}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
					<DialogFooter>
						{isVolume ? null : (
							<Button variant="outline" onClick={() => setRestoreTarget(null)}>
								Cancel
							</Button>
						)}
						<Button
							variant={isVolume ? "default" : "destructive"}
							disabled={!restoreKey || restore.isPending}
							onClick={submitRestore}
						>
							{restore.isPending && <Loader2 className="size-4 animate-spin" />}
							Restore
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{isVolume ? "Delete volume backup?" : "Delete backup?"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{isVolume
								? "The schedule is removed; archives already stored in the destination are kept."
								: "This removes the scheduled backup and cancels its cron job. Stored dumps in the destination are kept."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant={isVolume ? undefined : "destructive"}
							disabled={remove.isPending}
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								confirmDelete();
							}}
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
