"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { settleActivity, trackActivity } from "@/components/layout/activity-tray";
import { SettingsSection } from "@/components/layout/settings-section";
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
import { toastError } from "@/lib/describe-error";
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
	serviceId,
	backups,
}: {
	serviceId: string;
	backups: { id: string; database: string; cron: string }[];
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { role, canAll } = useCapabilities({ strict: true });
	const canCreate =
		(role === "owner" || role === "admin") &&
		canAll("backups.manage", "service.create", "service.deploy", "secrets.write");
	const canDelete =
		(role === "owner" || role === "admin") && canAll("backups.manage", "service.delete");
	const [selectedBackup, setSelectedBackup] = useState("");
	const backupId = selectedBackup || backups[0]?.id || "";
	const [open, setOpen] = useState(false);
	const [key, setKey] = useState("");
	const [name, setName] = useState("");
	const [environmentId, setEnvironmentId] = useState("");
	const [requestId, setRequestId] = useState("");
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const fieldId = useId();
	const source = useQuery(trpc.postgres.one.queryOptions({ postgresId: serviceId }));
	const projects = useQuery({ ...trpc.project.all.queryOptions(), enabled: open });
	const keys = useQuery({
		...trpc.backup.listBackups.queryOptions({ backupId }),
		enabled: open && !!backupId,
	});
	const copies = useQuery({
		...trpc.backup.copies.queryOptions({ backupId }),
		enabled: !!backupId,
	});
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
	const deletion = copies.data?.find((row) => row.recoveryCopyId === deleteId);
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: trpc.backup.copies.queryKey({ backupId }) });
	const openForm = () => {
		setKey("");
		setName("Recovery copy");
		setEnvironmentId("");
		setRequestId(crypto.randomUUID());
		setOpen(true);
	};
	const submit = () => {
		const activity = trackActivity({
			id: `recovery-copy:${requestId}`,
			kind: "clone",
			label: `Create ${name.trim()}`,
			detail: "Validate archive → restore → verify",
		});
		create.mutate(
			{ backupId, key, name: name.trim(), environmentId, requestId },
			{
				onSuccess: (result) => {
					settleActivity(
						activity,
						result.status === "ready" ? "done" : "error",
						result.status === "ready" ? "Private copy verified" : "Review recovery history",
					);
					void refresh();
					void queryClient.invalidateQueries({ queryKey: trpc.project.all.queryKey() });
					if (result.status === "ready") {
						toast.success("Recovery copy ready");
						setOpen(false);
					} else {
						// A definite failure is a finished attempt. A corrected dump or
						// target must be a new request; network errors retain the old ID.
						if (result.status === "error") setRequestId(crypto.randomUUID());
						toastError(
							new Error(
								result.error ??
									"The copy is still running. Refresh its history to check the result.",
							),
							"Recovery copy needs attention",
						);
					}
				},
				onError: (error) => {
					settleActivity(activity, "error", "Refresh recovery history before retrying");
					void refresh();
					toastError(error, "Recovery request failed");
				},
			},
		);
	};
	return (
		<SettingsSection
			wide
			title="Recovery copies"
			description="Restore a PostgreSQL dump into a separate private environment for investigation or development. Copies keep the original data and stay until you delete them."
			actions={
				<Button
					size="sm"
					variant="outline"
					disabled={
						!backupId || !canCreate || source.isPending || source.isError || create.isPending
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
			}
		>
			{backups.length > 1 && (
				<div className="mb-4 max-w-sm">
					<Label htmlFor={`${fieldId}-backup`}>Backup schedule</Label>
					<Select value={backupId} onValueChange={setSelectedBackup} disabled={create.isPending}>
						<SelectTrigger id={`${fieldId}-backup`} className="mt-1 w-full">
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
			{!backupId ? (
				<p className="text-sm text-muted-foreground">
					Create a backup schedule and run a dump to make your first recovery copy.
				</p>
			) : copies.isPending ? (
				<Skeleton className="h-20 w-full" />
			) : copies.isError ? (
				<div role="alert" className="space-y-2">
					<p className="text-sm">Recovery history could not be loaded.</p>
					<Button size="sm" variant="outline" onClick={() => copies.refetch()}>
						Try again
					</Button>
				</div>
			) : (
				<div className="space-y-3">
					<div className="flex items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">
							Latest 100 copies · Private network · Fresh credentials
						</p>
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
					{copies.data?.length === 0 ? (
						<p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
							No recovery copies yet. Your source database and stored dumps are preserved when you
							create one.
						</p>
					) : (
						<ul className="divide-y rounded-lg border">
							{copies.data?.map((row) => (
								<li key={row.recoveryCopyId} className="flex flex-wrap items-start gap-3 p-4">
									<div className="min-w-0 flex-1 basis-52">
										<div className="flex flex-wrap items-center gap-2">
											<p className="text-sm font-medium">{row.name}</p>
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
											className="mt-1 truncate font-mono text-xs text-muted-foreground"
											title={row.objectKey}
										>
											{row.objectKey}
										</p>
										{row.error && <p className="mt-2 text-sm text-destructive">{row.error}</p>}
										{row.status === "interrupted" && (
											<p className="mt-2 text-sm text-muted-foreground">
												The operation did not report a result. Inspect the retained database or
												delete this copy.
											</p>
										)}
									</div>
									<div className="flex shrink-0 items-center gap-1">
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
												disabled={!canDelete || ACTIVE.has(row.status) || remove.isPending}
												onClick={() => setDeleteId(row.recoveryCopyId)}
											>
												<Trash2 className="size-4" />
											</Button>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
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
							A new PostgreSQL service uses the source image and server, with fresh credentials and
							no published port. The copied data is not sanitized. The source is preserved.
						</DialogDescription>
					</DialogHeader>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
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
							<p role="status" className="status-spine text-sm">
								Validating, restoring and verifying the new database. This can take up to ten
								minutes.
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
							<Button
								type="submit"
								disabled={!key || !name.trim() || !environmentId || !canCreate || create.isPending}
							>
								{create.isPending && <Loader2 className="size-4 animate-spin" />}Create private copy
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
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
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={remove.isPending || !deleteId}
							onClick={(event) => {
								event.preventDefault();
								if (!deleteId) return;
								const activity = trackActivity({
									id: `delete-copy:${deleteId}`,
									kind: "clone",
									label: "Delete recovery copy",
								});
								remove.mutate(
									{ recoveryCopyId: deleteId },
									{
										onSuccess: () => {
											settleActivity(activity, "done");
											setDeleteId(null);
											void refresh();
											void queryClient.invalidateQueries({ queryKey: trpc.project.all.queryKey() });
											toast.success("Recovery copy deleted");
										},
										onError: (error) => {
											settleActivity(activity, "error");
											void refresh();
											toastError(error, "Deletion failed");
										},
									},
								);
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
