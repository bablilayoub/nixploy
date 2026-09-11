"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { formatDistanceToNow } from "date-fns";
import { CalendarClock, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { SettingsSection } from "@/components/settings/settings-section";
import { StatusDot } from "@/components/shell";
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
import { TableCard } from "@/components/ui/table-card";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { describeError, toastError } from "@/lib/describe-error";
import { scheduleRunStatusDot } from "@/lib/status";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type ServiceType = "application" | "compose" | "server" | "nixploy-server";
type ScheduleEntry = inferRouterOutputs<AppRouter>["schedule"]["byService"][number];

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

const EMPTY_FORM = {
	name: "",
	cronExpression: "0 0 * * *",
	shellType: "bash" as "bash" | "sh",
	command: "",
	enabled: true,
};

export function SchedulesTab({
	serviceType,
	serviceId,
}: {
	serviceType: ServiceType;
	serviceId: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can, role, isInstanceAdmin, isLoading: capabilitiesLoading } = useCapabilities();
	// Every schedule mutation needs schedules.manage; managed servers additionally
	// need an org admin and the Nixploy host an instance admin.
	const hasManage = can("schedules.manage");
	const isOrgAdmin = ["admin", "owner"].some((part) =>
		(role ?? "")
			.split(",")
			.map((segment) => segment.trim())
			.includes(part),
	);
	const canManage =
		hasManage &&
		(serviceType === "nixploy-server"
			? isInstanceAdmin
			: serviceType === "server"
				? // `role` is null until the capabilities query settles.
					isOrgAdmin || capabilitiesLoading
				: true);
	const manageHint = canManage
		? undefined
		: !hasManage
			? capabilityHint("schedules.manage")
			: serviceType === "nixploy-server"
				? "Requires an instance administrator"
				: "Requires an organization admin";

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<ScheduleEntry | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [deleteTarget, setDeleteTarget] = useState<ScheduleEntry | null>(null);

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm(EMPTY_FORM);
		}
	}, [dialogOpen]);

	const queryInput = { serviceId, serviceType };
	const {
		data: schedules,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.schedule.byService.queryOptions(queryInput));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.schedule.byService.queryKey(queryInput),
		});

	const create = useMutation(
		trpc.schedule.create.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule created");
				setDialogOpen(false);
				invalidate();
			},
			onError: (mutationError) => toastError(mutationError),
		}),
	);
	const update = useMutation(
		trpc.schedule.update.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule updated");
				setDialogOpen(false);
				invalidate();
			},
			onError: (mutationError) => toastError(mutationError),
		}),
	);
	const remove = useMutation(
		trpc.schedule.remove.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule deleted");
				setDeleteTarget(null);
				invalidate();
			},
			onError: (mutationError) => toastError(mutationError),
		}),
	);
	const runNow = useMutation(
		trpc.schedule.runManually.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule run completed");
				invalidate();
			},
			onError: (mutationError) => {
				toast.error(`Run failed: ${describeError(mutationError)}`);
				invalidate();
			},
		}),
	);
	const setEnabled = useMutation(
		trpc.schedule.enable.mutationOptions({
			onSuccess: invalidate,
			onError: (mutationError) => toastError(mutationError),
		}),
	);
	const setDisabled = useMutation(
		trpc.schedule.disable.mutationOptions({
			onSuccess: invalidate,
			onError: (mutationError) => toastError(mutationError),
		}),
	);

	const saving = create.isPending || update.isPending;
	const isValid =
		form.name.trim() !== "" && looksLikeCron(form.cronExpression) && form.command.trim() !== "";
	const presetValue = CRON_PRESETS.some((preset) => preset.value === form.cronExpression)
		? form.cronExpression
		: "custom";

	const openEdit = (schedule: ScheduleEntry) => {
		setEditing(schedule);
		setForm({
			name: schedule.name,
			cronExpression: schedule.cronExpression,
			shellType: schedule.shellType,
			command: schedule.command,
			enabled: schedule.enabled,
		});
		setDialogOpen(true);
	};

	const onSubmit = () => {
		if (editing) {
			update.mutate({
				scheduleId: editing.scheduleId,
				name: form.name,
				cronExpression: form.cronExpression,
				shellType: form.shellType,
				command: form.command,
			});
		} else {
			create.mutate({
				name: form.name,
				cronExpression: form.cronExpression,
				shellType: form.shellType,
				command: form.command,
				enabled: form.enabled,
				scheduleType: serviceType,
				applicationId: serviceType === "application" ? serviceId : null,
				composeId: serviceType === "compose" ? serviceId : null,
				serverId: serviceType === "server" ? serviceId : null,
			});
		}
	};

	return (
		<>
			<SettingsSection
				title="Schedules"
				description={
					serviceType === "nixploy-server"
						? "Cron shell jobs on this Nixploy host."
						: serviceType === "server"
							? "Cron shell jobs over SSH on the managed server."
							: "Cron shell jobs inside the service container."
				}
				actions={
					<Button
						size="sm"
						disabled={!canManage}
						title={manageHint}
						onClick={() => setDialogOpen(true)}
					>
						<Plus className="size-4" />
						Add schedule
					</Button>
				}
			>
				<QueryState
					isPending={isPending}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!schedules || schedules.length === 0}
					skeleton={
						<div className="flex flex-col gap-2">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					}
					empty={
						<EmptyState
							icon={CalendarClock}
							title="No schedules"
							description="Add a cron job to run a command on a schedule."
						/>
					}
				>
					<TableCard framed={false}>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Schedule</TableHead>
									<TableHead>Command</TableHead>
									<TableHead>Last run</TableHead>
									<TableHead>Enabled</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(schedules ?? []).map((schedule) => (
									<TableRow key={schedule.scheduleId}>
										<TableCell className="max-w-40 truncate font-medium">{schedule.name}</TableCell>
										<TableCell className="font-mono text-xs">{schedule.cronExpression}</TableCell>
										<TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
											{schedule.command}
										</TableCell>
										<TableCell>
											{schedule.lastStatus ? (
												<span
													className="flex items-center gap-2 text-sm"
													title={schedule.lastError ?? undefined}
												>
													<StatusDot
														status={scheduleRunStatusDot[schedule.lastStatus] ?? "neutral"}
													/>
													{schedule.lastRunAt
														? formatDistanceToNow(new Date(schedule.lastRunAt), { addSuffix: true })
														: schedule.lastStatus}
												</span>
											) : (
												<span className="text-sm text-muted-foreground">Never</span>
											)}
										</TableCell>
										<TableCell>
											<Switch
												checked={schedule.enabled}
												disabled={setEnabled.isPending || setDisabled.isPending || !canManage}
												title={manageHint}
												onCheckedChange={(checked) =>
													checked
														? setEnabled.mutate({
																scheduleId: schedule.scheduleId,
															})
														: setDisabled.mutate({
																scheduleId: schedule.scheduleId,
															})
												}
											/>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													aria-label="Run schedule now"
													title={manageHint ?? "Run now"}
													disabled={runNow.isPending || !canManage}
													onClick={() => runNow.mutate({ scheduleId: schedule.scheduleId })}
												>
													{runNow.isPending &&
													runNow.variables?.scheduleId === schedule.scheduleId ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Play className="size-4" />
													)}
												</Button>
												<Button
													variant="ghost"
													size="sm"
													aria-label="Edit schedule"
													title={manageHint}
													disabled={!canManage}
													onClick={() => openEdit(schedule)}
												>
													<Pencil className="size-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													aria-label="Delete schedule"
													title={manageHint}
													disabled={!canManage}
													onClick={() => setDeleteTarget(schedule)}
												>
													<Trash2 className="size-4 text-destructive" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableCard>
				</QueryState>
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit schedule" : "Add schedule"}</DialogTitle>
						<DialogDescription>
							The command runs inside the service container on the given cron schedule.
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
							<Label htmlFor="schedule-name">Name</Label>
							<Input
								id="schedule-name"
								placeholder="Nightly cleanup"
								value={form.name}
								onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="schedule-cron">Cron expression (UTC)</Label>
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
								id="schedule-cron"
								className="font-mono text-sm"
								placeholder="0 0 * * *"
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
							<Label htmlFor="schedule-shell">Shell</Label>
							<Select
								value={form.shellType}
								onValueChange={(value) =>
									setForm((f) => ({ ...f, shellType: value as "bash" | "sh" }))
								}
							>
								<SelectTrigger id="schedule-shell">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="bash">bash</SelectItem>
									<SelectItem value="sh">sh</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="schedule-command">Command</Label>
							<Textarea
								id="schedule-command"
								className="font-mono text-sm"
								rows={3}
								placeholder="pg_dump -U postgres mydb > /backups/mydb.sql"
								value={form.command}
								onChange={(event) => setForm((f) => ({ ...f, command: event.target.value }))}
							/>
						</div>
						{!editing && (
							<div className="flex items-center gap-2">
								<Switch
									id="schedule-enabled"
									checked={form.enabled}
									onCheckedChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
								/>
								<Label htmlFor="schedule-enabled" className="font-normal">
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

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete schedule?</AlertDialogTitle>
						<AlertDialogDescription>
							{deleteTarget?.name} will no longer run on its cron schedule.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleteTarget) remove.mutate({ scheduleId: deleteTarget.scheduleId });
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
