"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { ArchiveRestore, DatabaseBackup, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { SettingsSection } from "@/components/settings/settings-section";
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
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type ServiceType = "application" | "compose";
type VolumeBackupEntry = inferRouterOutputs<AppRouter>["volumeBackup"]["all"][number];

const CRON_PRESETS = [
	{ label: "Every hour", value: "0 * * * *" },
	{ label: "Every 6 hours", value: "0 */6 * * *" },
	{ label: "Every day at midnight", value: "0 0 * * *" },
	{ label: "Every week (Sunday)", value: "0 0 * * 0" },
] as const;

function looksLikeCron(expression: string): boolean {
	const fields = expression.trim().split(/\s+/);
	return fields.length === 5 || fields.length === 6;
}

const EMPTY_FORM = {
	name: "",
	volumeName: "",
	cronExpression: "0 0 * * *",
	prefix: "volume-backup",
	keepLatestCount: "",
	destinationId: "",
	enabled: true,
};

export function VolumeBackupsTab({
	serviceType,
	serviceId,
}: {
	serviceType: ServiceType;
	serviceId: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const canManage = can("backups.manage");
	const manageHint = canManage ? undefined : capabilityHint("backups.manage");

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<VolumeBackupEntry | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [deleteTarget, setDeleteTarget] = useState<VolumeBackupEntry | null>(null);
	const [restoreTarget, setRestoreTarget] = useState<VolumeBackupEntry | null>(null);
	const [restoreKey, setRestoreKey] = useState<string>("");

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm(EMPTY_FORM);
		}
	}, [dialogOpen]);

	const queryInput = { serviceId, serviceType };
	const {
		data: backups,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.volumeBackup.all.queryOptions(queryInput));
	const destinationsQuery = useQuery(trpc.destination.all.queryOptions());
	const destinations = destinationsQuery.data;
	const keysQuery = useQuery({
		...trpc.volumeBackup.listBackups.queryOptions({
			volumeBackupId: restoreTarget?.volumeBackupId ?? "",
		}),
		enabled: restoreTarget !== null,
	});
	const backupKeys = keysQuery.data;
	const keysPending = keysQuery.isPending;

	const destinationName = (destinationId: string) =>
		destinations?.find((destination) => destination.destinationId === destinationId)?.name ??
		"Unknown";

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.volumeBackup.all.queryKey(queryInput),
		});

	const create = useMutation(
		trpc.volumeBackup.create.mutationOptions({
			onSuccess: () => {
				toast.success("Volume backup created");
				setDialogOpen(false);
				invalidate();
			},
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const update = useMutation(
		trpc.volumeBackup.update.mutationOptions({
			onSuccess: () => {
				toast.success("Volume backup updated");
				setDialogOpen(false);
				invalidate();
			},
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const remove = useMutation(
		trpc.volumeBackup.remove.mutationOptions({
			onSuccess: () => {
				toast.success("Volume backup deleted");
				setDeleteTarget(null);
				invalidate();
			},
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const runNow = useMutation(
		trpc.volumeBackup.runManually.mutationOptions({
			onSuccess: () => toast.success("Backup uploaded"),
			// The server answers BAD_REQUEST "already running" while a run is in
			// flight — its message is already user-facing, so show it verbatim.
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const restore = useMutation(
		trpc.volumeBackup.restore.mutationOptions({
			onSuccess: () => {
				toast.success("Volume restored");
				setRestoreTarget(null);
			},
			onError: (mutationError) => toast.error(`Restore failed: ${mutationError.message}`),
		}),
	);
	const toggleEnabled = useMutation(
		trpc.volumeBackup.update.mutationOptions({
			onSuccess: invalidate,
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);

	const saving = create.isPending || update.isPending;
	const keepLatest = form.keepLatestCount.trim();
	const isValid =
		form.name.trim() !== "" &&
		form.volumeName.trim() !== "" &&
		looksLikeCron(form.cronExpression) &&
		form.destinationId !== "" &&
		(keepLatest === "" || (Number.isInteger(Number(keepLatest)) && Number(keepLatest) >= 1));
	const presetValue = CRON_PRESETS.some((preset) => preset.value === form.cronExpression)
		? form.cronExpression
		: "custom";

	const openEdit = (backup: VolumeBackupEntry) => {
		setEditing(backup);
		setForm({
			name: backup.name,
			volumeName: backup.volumeName,
			cronExpression: backup.cronExpression,
			prefix: backup.prefix,
			keepLatestCount: backup.keepLatestCount?.toString() ?? "",
			destinationId: backup.destinationId,
			enabled: backup.enabled,
		});
		setDialogOpen(true);
	};

	const keepLatestValue = keepLatest === "" ? null : Number(keepLatest);

	const onSubmit = () => {
		if (editing) {
			update.mutate({
				volumeBackupId: editing.volumeBackupId,
				name: form.name,
				volumeName: form.volumeName,
				cronExpression: form.cronExpression,
				prefix: form.prefix || undefined,
				keepLatestCount: keepLatestValue,
				destinationId: form.destinationId,
			});
		} else {
			create.mutate({
				name: form.name,
				volumeName: form.volumeName,
				serviceType,
				serviceId,
				cronExpression: form.cronExpression,
				enabled: form.enabled,
				prefix: form.prefix || undefined,
				keepLatestCount: keepLatestValue,
				destinationId: form.destinationId,
			});
		}
	};

	const noDestinations = destinations !== undefined && destinations.length === 0;

	return (
		<>
			<SettingsSection
				title="Volume Backups"
				description="Volume archives to S3 on a cron."
				actions={
					<Button
						size="sm"
						disabled={noDestinations || !canManage}
						title={manageHint}
						onClick={() => setDialogOpen(true)}
					>
						<Plus className="size-4" />
						Add Backup
					</Button>
				}
			>
				{noDestinations ? (
					<EmptyState
						icon={DatabaseBackup}
						title="No backup storage"
						description="Add an S3 destination in Settings → Backup storage first."
					/>
				) : (
					<QueryState
						// A failed destinations fetch would otherwise render every row as "Unknown".
						isPending={isPending || destinationsQuery.isPending}
						isError={isError || destinationsQuery.isError}
						error={error ?? destinationsQuery.error}
						onRetry={() => {
							void refetch();
							void destinationsQuery.refetch();
						}}
						isEmpty={!backups || backups.length === 0}
						skeleton={
							<div className="flex flex-col gap-2">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
							</div>
						}
						empty={
							<EmptyState
								icon={DatabaseBackup}
								title="No volume backups"
								description="Schedule a volume archive to an S3 destination."
							/>
						}
					>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Volume</TableHead>
									<TableHead>Schedule</TableHead>
									<TableHead>Destination</TableHead>
									<TableHead>Enabled</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(backups ?? []).map((backup) => (
									<TableRow key={backup.volumeBackupId}>
										<TableCell className="max-w-40 truncate font-medium">{backup.name}</TableCell>
										<TableCell className="max-w-40 truncate font-mono text-xs">
											{backup.volumeName}
										</TableCell>
										<TableCell className="font-mono text-xs">{backup.cronExpression}</TableCell>
										<TableCell className="text-muted-foreground">
											{destinationName(backup.destinationId)}
										</TableCell>
										<TableCell>
											<Switch
												checked={backup.enabled}
												disabled={toggleEnabled.isPending || !canManage}
												title={manageHint}
												onCheckedChange={(checked) =>
													toggleEnabled.mutate({
														volumeBackupId: backup.volumeBackupId,
														enabled: checked,
													})
												}
											/>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													aria-label="Back up now"
													title={manageHint ?? "Back up now"}
													disabled={runNow.isPending || !canManage}
													onClick={() => runNow.mutate({ volumeBackupId: backup.volumeBackupId })}
												>
													{runNow.isPending &&
													runNow.variables?.volumeBackupId === backup.volumeBackupId ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Play className="size-4" />
													)}
												</Button>
												<Button
													variant="ghost"
													size="sm"
													aria-label="Restore volume backup"
													title={manageHint ?? "Restore"}
													disabled={!canManage}
													onClick={() => {
														setRestoreKey("");
														setRestoreTarget(backup);
													}}
												>
													<ArchiveRestore className="size-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													aria-label="Edit volume backup"
													title={manageHint}
													disabled={!canManage}
													onClick={() => openEdit(backup)}
												>
													<Pencil className="size-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													aria-label="Delete volume backup"
													title={manageHint}
													disabled={!canManage}
													onClick={() => setDeleteTarget(backup)}
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
				)}
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit Volume Backup" : "Add Volume Backup"}</DialogTitle>
						<DialogDescription>
							The volume is archived as a tarball and uploaded to the destination.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							onSubmit();
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="vb-name">Name</Label>
							<Input
								id="vb-name"
								placeholder="Nightly data backup"
								value={form.name}
								onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="vb-volume">Volume name</Label>
							<Input
								id="vb-volume"
								className="font-mono text-sm"
								placeholder="my-app-data"
								value={form.volumeName}
								onChange={(event) => setForm((f) => ({ ...f, volumeName: event.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="vb-cron">Cron expression (UTC)</Label>
							<Select
								value={presetValue}
								onValueChange={(value) => {
									if (value !== "custom") {
										setForm((f) => ({ ...f, cronExpression: value }));
									}
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
							<Input
								id="vb-cron"
								className="font-mono text-sm"
								value={form.cronExpression}
								onChange={(event) => setForm((f) => ({ ...f, cronExpression: event.target.value }))}
							/>
							{!looksLikeCron(form.cronExpression) && (
								<p className="text-xs text-destructive">
									Expected 5 or 6 fields: [second] minute hour day month weekday.
								</p>
							)}
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="vb-destination">Destination</Label>
							<Select
								value={form.destinationId}
								onValueChange={(value) => setForm((f) => ({ ...f, destinationId: value }))}
							>
								<SelectTrigger id="vb-destination">
									<SelectValue placeholder="Select a destination" />
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
							<div className="flex flex-col gap-2">
								<Label htmlFor="vb-prefix">Prefix</Label>
								<Input
									id="vb-prefix"
									className="font-mono text-sm"
									placeholder="volume-backup"
									value={form.prefix}
									onChange={(event) => setForm((f) => ({ ...f, prefix: event.target.value }))}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="vb-keep">Keep latest</Label>
								<Input
									id="vb-keep"
									inputMode="numeric"
									placeholder="All"
									value={form.keepLatestCount}
									onChange={(event) =>
										setForm((f) => ({ ...f, keepLatestCount: event.target.value }))
									}
								/>
							</div>
						</div>
						{!editing && (
							<div className="flex items-center gap-2">
								<Switch
									id="vb-enabled"
									checked={form.enabled}
									onCheckedChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
								/>
								<Label htmlFor="vb-enabled" className="font-normal">
									Enabled
								</Label>
							</div>
						)}
						<DialogFooter>
							<Button type="submit" disabled={!isValid || saving}>
								{saving && <Loader2 className="size-4 animate-spin" />}
								{editing ? "Save" : "Create"}
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
						<DialogTitle>Restore volume</DialogTitle>
						<DialogDescription>
							Volume <code className="rounded bg-muted px-1">{restoreTarget?.volumeName}</code> will
							be overwritten with the selected archive. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					{keysPending ? (
						<div className="flex flex-col gap-2">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : keysQuery.isError ? (
						// An S3 credential/connectivity failure must not read as "no archives".
						<div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-3">
							<p className="text-sm font-medium">Could not list stored archives</p>
							<p className="text-sm text-muted-foreground">{keysQuery.error.message}</p>
							<Button variant="outline" size="sm" onClick={() => keysQuery.refetch()}>
								Retry
							</Button>
						</div>
					) : !backupKeys || backupKeys.length === 0 ? (
						<p className="py-4 text-center text-sm text-muted-foreground">
							No stored archives found for this backup yet.
						</p>
					) : (
						<div className="flex flex-col gap-2">
							<Label htmlFor="vb-restore-key">Archive</Label>
							<Select value={restoreKey} onValueChange={setRestoreKey} disabled={restore.isPending}>
								<SelectTrigger id="vb-restore-key">
									<SelectValue placeholder="Select an archive" />
								</SelectTrigger>
								<SelectContent>
									{backupKeys.map((key) => (
										<SelectItem key={key} value={key}>
											<span className="font-mono text-xs">{key.split("/").pop()}</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					<DialogFooter>
						<Button
							disabled={!restoreKey || restore.isPending}
							onClick={() =>
								restoreTarget &&
								restore.mutate({ volumeBackupId: restoreTarget.volumeBackupId, key: restoreKey })
							}
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
						<AlertDialogTitle>Delete volume backup?</AlertDialogTitle>
						<AlertDialogDescription>
							The schedule is removed; archives already stored in the destination are kept.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleteTarget) remove.mutate({ volumeBackupId: deleteTarget.volumeBackupId });
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
