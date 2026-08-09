"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DatabaseBackup, Loader2, Pencil, Play, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
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

/** The `database` column is informational for instance backups (DATABASE_URL is authoritative). */
const INSTANCE_DATABASE_LABEL = "instance";

interface InstanceBackupFormState {
	schedule: string;
	prefix: string;
	keepLatestCount: string;
	destinationId: string;
	enabled: boolean;
}

const emptyForm: InstanceBackupFormState = {
	schedule: "0 3 * * *",
	prefix: "backup",
	keepLatestCount: "",
	destinationId: "",
	enabled: true,
};

export function InstanceBackups() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const listInput = { databaseType: "web-server" as const };
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
				toast.success("Instance backup updated");
				invalidate();
			},
			onError,
		}),
	);
	const removeMutation = useMutation(
		trpc.backup.remove.mutationOptions({
			onSuccess: () => {
				toast.success("Instance backup deleted");
				invalidate();
			},
			onError,
		}),
	);
	const runMutation = useMutation(
		trpc.backup.runManually.mutationOptions({
			onSuccess: () => toast.success("Instance backup started"),
			onError,
		}),
	);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState<InstanceBackupFormState>(emptyForm);

	const openCreate = () => {
		setEditingId(null);
		setForm(emptyForm);
		setDialogOpen(true);
	};

	const openEdit = (backup: (typeof backups)[number]) => {
		setEditingId(backup.backupId);
		setForm({
			schedule: backup.schedule,
			prefix: backup.prefix,
			keepLatestCount: backup.keepLatestCount?.toString() ?? "",
			destinationId: backup.destinationId,
			enabled: backup.enabled,
		});
		setDialogOpen(true);
	};

	return (
		<>
			<SettingsSection
				title="Instance backups"
				description="Scheduled dumps of this Nixploy instance itself — the platform database plus the config directory (Traefik configs, certificates). Restore is manual, see docs/instance-backup.md."
				actions={
					<Button size="sm" onClick={openCreate} disabled={destinations.length === 0}>
						<Plus className="size-4" />
						Create instance backup
					</Button>
				}
			>
				{backupsQuery.isLoading ? (
					<div className="space-y-2">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : backups.length === 0 ? (
					<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
						<DatabaseBackup className="size-8 text-muted-foreground" />
						<p className="text-sm font-medium">No instance backups yet</p>
						<p className="text-sm text-muted-foreground">
							Protect the platform itself so a failed host does not take your setup with it.
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
												aria-label="Run instance backup now"
												title="Run now"
												disabled={runMutation.isPending}
												onClick={() => runMutation.mutate({ backupId: backup.backupId })}
											>
												<Play className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="Edit instance backup"
												title="Edit"
												onClick={() => openEdit(backup)}
											>
												<Pencil className="size-4" />
											</Button>
											<ConfirmDeleteDialog
												title="Delete instance backup?"
												description="This removes the scheduled backup and cancels its cron job. Stored archives in the destination are kept."
												isPending={removeMutation.isPending}
												onConfirm={() => removeMutation.mutate({ backupId: backup.backupId })}
											/>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</SettingsSection>

			<InstanceBackupFormDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				editingId={editingId}
				form={form}
				setForm={setForm}
				destinations={destinations}
				onSaved={invalidate}
			/>
		</>
	);
}

function InstanceBackupFormDialog({
	open,
	onOpenChange,
	editingId,
	form,
	setForm,
	destinations,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editingId: string | null;
	form: InstanceBackupFormState;
	setForm: (form: InstanceBackupFormState) => void;
	destinations: { destinationId: string; name: string }[];
	onSaved: () => void;
}) {
	const trpc = useTRPC();

	const onError = (error: { message?: string }) =>
		toast.error(error.message ?? "Something went wrong");

	const createMutation = useMutation(
		trpc.backup.create.mutationOptions({
			onSuccess: () => {
				toast.success("Instance backup created");
				onSaved();
				onOpenChange(false);
			},
			onError,
		}),
	);
	const updateMutation = useMutation(
		trpc.backup.update.mutationOptions({
			onSuccess: () => {
				toast.success("Instance backup updated");
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
		form.destinationId !== "" &&
		keepValid;

	const submit = () => {
		const base = {
			schedule: form.schedule.trim(),
			enabled: form.enabled,
			prefix: form.prefix.trim(),
			keepLatestCount,
			destinationId: form.destinationId,
		};
		if (editingId) {
			updateMutation.mutate({ backupId: editingId, ...base });
		} else {
			createMutation.mutate({
				...base,
				database: INSTANCE_DATABASE_LABEL,
				databaseType: "web-server",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{editingId ? "Edit instance backup" : "Create instance backup"}</DialogTitle>
					<DialogDescription>
						Schedule a recurring dump of the platform database and config directory to an S3
						destination.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="instance-backup-schedule">Schedule (cron)</Label>
						<Input
							id="instance-backup-schedule"
							value={form.schedule}
							onChange={(e) => setForm({ ...form, schedule: e.target.value })}
							placeholder="0 3 * * *"
							className="font-mono"
						/>
						<p className="text-sm text-muted-foreground">
							Examples: <code>0 3 * * *</code> daily at 3:00, <code>0 */6 * * *</code> every 6
							hours.
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
							<Label htmlFor="instance-backup-prefix">Prefix</Label>
							<Input
								id="instance-backup-prefix"
								value={form.prefix}
								onChange={(e) => setForm({ ...form, prefix: e.target.value })}
								className="font-mono"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="instance-backup-keep">Keep latest count (optional)</Label>
							<Input
								id="instance-backup-keep"
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
					</div>
					<div className="flex items-center gap-2">
						<Switch
							id="instance-backup-enabled"
							checked={form.enabled}
							onCheckedChange={(enabled) => setForm({ ...form, enabled })}
						/>
						<Label htmlFor="instance-backup-enabled">Enabled</Label>
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
