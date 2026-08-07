"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DatabaseBackup, Loader2, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BackupDatabaseType } from "@/components/databases/database-types";
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
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import { useTRPC } from "@/lib/trpc";

interface DatabaseBackupsProps {
	databaseType: BackupDatabaseType;
	serviceId: string;
	/** Default database name to dump (prefills the create form). */
	databaseName: string;
}

interface BackupFormState {
	schedule: string;
	prefix: string;
	database: string;
	keepLatestCount: string;
	destinationId: string;
	enabled: boolean;
}

const emptyForm = (databaseName: string): BackupFormState => ({
	schedule: "0 3 * * *",
	prefix: "backup",
	database: databaseName,
	keepLatestCount: "",
	destinationId: "",
	enabled: true,
});

export function DatabaseBackups({ databaseType, serviceId, databaseName }: DatabaseBackupsProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const listInput = { serviceId, databaseType };
	const backupsQuery = useQuery(trpc.backup.all.queryOptions(listInput));
	const destinationsQuery = useQuery(trpc.destination.all.queryOptions());

	const backups = backupsQuery.data ?? [];
	const destinations = destinationsQuery.data ?? [];
	const destinationName = (id: string) =>
		destinations.find((d) => d.destinationId === id)?.name ?? "Unknown";

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: trpc.backup.all.queryKey(listInput) });

	const onError = (error: { message?: string }) =>
		toast.error(error.message ?? "Something went wrong");

	const updateMutation = useMutation(
		trpc.backup.update.mutationOptions({
			onSuccess: () => {
				toast.success("Backup updated");
				invalidate();
			},
			onError,
		}),
	);
	const removeMutation = useMutation(
		trpc.backup.remove.mutationOptions({
			onSuccess: () => {
				toast.success("Backup deleted");
				invalidate();
			},
			onError,
		}),
	);
	const runMutation = useMutation(
		trpc.backup.runManually.mutationOptions({
			onSuccess: () => toast.success("Backup started"),
			onError,
		}),
	);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState<BackupFormState>(() => emptyForm(databaseName));

	const openCreate = () => {
		setEditingId(null);
		setForm(emptyForm(databaseName));
		setDialogOpen(true);
	};

	const openEdit = (backup: (typeof backups)[number]) => {
		setEditingId(backup.backupId);
		setForm({
			schedule: backup.schedule,
			prefix: backup.prefix,
			database: backup.database,
			keepLatestCount: backup.keepLatestCount?.toString() ?? "",
			destinationId: backup.destinationId,
			enabled: backup.enabled,
		});
		setDialogOpen(true);
	};

	return (
		<>
			<SettingsSection
				title="Backups"
				description="Scheduled dumps uploaded to an S3 destination. Restore from any stored dump."
				wide
				actions={
					<Button size="sm" onClick={openCreate} disabled={destinations.length === 0}>
						<Plus className="size-4" />
						Create backup
					</Button>
				}
			>
				{backupsQuery.isLoading ? (
					<div className="space-y-2">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : backupsQuery.isError || destinationsQuery.isError ? (
					<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
						<p className="text-sm font-medium">Could not load backups</p>
						<p className="text-sm text-muted-foreground">
							{backupsQuery.error?.message ??
								destinationsQuery.error?.message ??
								"Try again in a moment."}
						</p>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								void backupsQuery.refetch();
								void destinationsQuery.refetch();
							}}
						>
							Retry
						</Button>
					</div>
				) : destinations.length === 0 ? (
					<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
						<DatabaseBackup className="size-8 text-muted-foreground" />
						<p className="text-sm font-medium">No S3 destinations configured</p>
						<p className="text-sm text-muted-foreground">
							Add a destination under Settings → Backup storage before creating backups.
						</p>
					</div>
				) : backups.length === 0 ? (
					<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
						<DatabaseBackup className="size-8 text-muted-foreground" />
						<p className="text-sm font-medium">No backups yet</p>
						<p className="text-sm text-muted-foreground">
							Create a scheduled backup to protect this database.
						</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Schedule</TableHead>
								<TableHead>Destination</TableHead>
								<TableHead>Prefix</TableHead>
								<TableHead>Enabled</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{backups.map((backup) => (
								<TableRow key={backup.backupId}>
									<TableCell>
										<code className="rounded bg-muted px-1.5 py-0.5 text-xs">
											{backup.schedule}
										</code>
									</TableCell>
									<TableCell>
										<Badge variant="outline">{destinationName(backup.destinationId)}</Badge>
									</TableCell>
									<TableCell className="font-mono text-xs">{backup.prefix}</TableCell>
									<TableCell>
										<Switch
											checked={backup.enabled}
											disabled={updateMutation.isPending}
											onCheckedChange={(enabled) =>
												updateMutation.mutate({ backupId: backup.backupId, enabled })
											}
										/>
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{format(new Date(backup.createdAt), "PP")}
									</TableCell>
									<TableCell>
										<div className="flex items-center justify-end gap-1">
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="Run backup now"
												title="Run now"
												disabled={runMutation.isPending}
												onClick={() => runMutation.mutate({ backupId: backup.backupId })}
											>
												<Play className="size-4" />
											</Button>
											<RestoreDialog backupId={backup.backupId} />
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="Edit backup"
												title="Edit"
												onClick={() => openEdit(backup)}
											>
												<Pencil className="size-4" />
											</Button>
											<AlertDialog>
												<AlertDialogTrigger asChild>
													<Button
														variant="ghost"
														size="icon-sm"
														aria-label="Delete backup"
														title="Delete"
													>
														<Trash2 className="size-4 text-destructive" />
													</Button>
												</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>Delete backup?</AlertDialogTitle>
														<AlertDialogDescription>
															This removes the scheduled backup and cancels its cron job. Stored
															dumps in the destination are kept.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction
															variant="destructive"
															onClick={() => removeMutation.mutate({ backupId: backup.backupId })}
														>
															Delete
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</SettingsSection>

			<BackupFormDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				editingId={editingId}
				form={form}
				setForm={setForm}
				databaseType={databaseType}
				serviceId={serviceId}
				destinations={destinations}
				onSaved={invalidate}
			/>
		</>
	);
}

function BackupFormDialog({
	open,
	onOpenChange,
	editingId,
	form,
	setForm,
	databaseType,
	serviceId,
	destinations,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editingId: string | null;
	form: BackupFormState;
	setForm: (form: BackupFormState) => void;
	databaseType: BackupDatabaseType;
	serviceId: string;
	destinations: { destinationId: string; name: string }[];
	onSaved: () => void;
}) {
	const trpc = useTRPC();

	const onError = (error: { message?: string }) =>
		toast.error(error.message ?? "Something went wrong");

	const createMutation = useMutation(
		trpc.backup.create.mutationOptions({
			onSuccess: () => {
				toast.success("Backup created");
				onSaved();
				onOpenChange(false);
			},
			onError,
		}),
	);
	const updateMutation = useMutation(
		trpc.backup.update.mutationOptions({
			onSuccess: () => {
				toast.success("Backup updated");
				onSaved();
				onOpenChange(false);
			},
			onError,
		}),
	);

	const isPending = createMutation.isPending || updateMutation.isPending;
	const keepLatestCount = form.keepLatestCount.trim() === "" ? null : Number(form.keepLatestCount);
	const keepValid =
		keepLatestCount === null || (Number.isInteger(keepLatestCount) && keepLatestCount >= 1);
	const valid =
		form.schedule.trim() !== "" &&
		form.prefix.trim() !== "" &&
		form.database.trim() !== "" &&
		form.destinationId !== "" &&
		keepValid;

	const submit = () => {
		const base = {
			schedule: form.schedule.trim(),
			enabled: form.enabled,
			prefix: form.prefix.trim(),
			database: form.database.trim(),
			keepLatestCount,
			destinationId: form.destinationId,
		};
		if (editingId) {
			updateMutation.mutate({ backupId: editingId, ...base });
		} else {
			createMutation.mutate({ ...base, databaseType, serviceId });
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{editingId ? "Edit backup" : "Create backup"}</DialogTitle>
					<DialogDescription>
						Schedule a recurring database dump to an S3 destination.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="backup-schedule">Schedule (cron)</Label>
						<Input
							id="backup-schedule"
							value={form.schedule}
							onChange={(e) => setForm({ ...form, schedule: e.target.value })}
							placeholder="0 3 * * *"
							className="font-mono"
						/>
						<p className="text-sm text-muted-foreground">
							Examples: <code>0 3 * * *</code> daily at 3:00, <code>0 */6 * * *</code> every 6
							hours, <code>0 0 * * 0</code> weekly on Sunday.
						</p>
					</div>
					<div className="space-y-1.5">
						<Label>Destination</Label>
						<Select
							value={form.destinationId}
							onValueChange={(destinationId) => setForm({ ...form, destinationId })}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select an S3 destination" />
							</SelectTrigger>
							<SelectContent>
								{destinations.map((d) => (
									<SelectItem key={d.destinationId} value={d.destinationId}>
										{d.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1.5">
							<Label htmlFor="backup-database">Database</Label>
							<Input
								id="backup-database"
								value={form.database}
								onChange={(e) => setForm({ ...form, database: e.target.value })}
								className="font-mono"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="backup-prefix">Prefix</Label>
							<Input
								id="backup-prefix"
								value={form.prefix}
								onChange={(e) => setForm({ ...form, prefix: e.target.value })}
								className="font-mono"
							/>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="backup-keep">Keep latest count (optional)</Label>
						<Input
							id="backup-keep"
							type="number"
							min={1}
							value={form.keepLatestCount}
							onChange={(e) => setForm({ ...form, keepLatestCount: e.target.value })}
							placeholder="Keep all"
						/>
						{!keepValid && (
							<p className="text-sm text-destructive">Enter a whole number of at least 1.</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Switch
							id="backup-enabled"
							checked={form.enabled}
							onCheckedChange={(enabled) => setForm({ ...form, enabled })}
						/>
						<Label htmlFor="backup-enabled">Enabled</Label>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={submit} disabled={!valid || isPending}>
						{isPending && <Loader2 className="size-4 animate-spin" />}
						{editingId ? "Save changes" : "Create backup"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RestoreDialog({ backupId }: { backupId: string }) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [key, setKey] = useState<string>("");

	const keysQuery = useQuery({
		...trpc.backup.listBackups.queryOptions({ backupId }),
		enabled: open,
	});
	const keys = keysQuery.data ?? [];

	const restoreMutation = useMutation(
		trpc.backup.restore.mutationOptions({
			onSuccess: () => {
				toast.success("Restore started");
				setOpen(false);
			},
			onError: (error: { message?: string }) => toast.error(error.message ?? "Restore failed"),
		}),
	);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setKey("");
			}}
		>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Restore backup"
				title="Restore"
				onClick={() => setOpen(true)}
			>
				<RotateCcw className="size-4" />
			</Button>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Restore backup</DialogTitle>
					<DialogDescription>
						Restore the database from a stored dump. The current data will be overwritten.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-1.5">
					<Label>Stored dump</Label>
					{keysQuery.isLoading ? (
						<Skeleton className="h-9 w-full" />
					) : keys.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No dumps found in the destination for this backup yet.
						</p>
					) : (
						<Select value={key} onValueChange={setKey}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select a dump to restore" />
							</SelectTrigger>
							<SelectContent>
								{keys.map((k) => (
									<SelectItem key={k} value={k}>
										<span className="font-mono text-xs">{k}</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={!key || restoreMutation.isPending}
						onClick={() => restoreMutation.mutate({ backupId, key })}
					>
						{restoreMutation.isPending && <Loader2 className="size-4 animate-spin" />}
						Restore
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
