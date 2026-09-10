"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { formatDistanceToNow } from "date-fns";
import { CalendarClock, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { PageHeader, StatusDot } from "@/components/shell";
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
import { scheduleRunStatusDot } from "@/lib/status";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type ScheduleRow = inferRouterOutputs<AppRouter>["schedule"]["all"][number];
type ScheduleType = ScheduleRow["scheduleType"];

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
	cronExpression: "0 0 * * *",
	shellType: "bash" as "bash" | "sh",
	command: "",
	enabled: true,
	scheduleType: "nixploy-server" as ScheduleType,
	targetId: "",
};

export function SchedulesView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can, role, isInstanceAdmin, isLoading: capabilitiesLoading } = useCapabilities();
	// Every schedule mutation needs schedules.manage. On top of that, "This
	// Nixploy host" schedules run a shell next to docker.sock — instance admins
	// only — and managed-server schedules need an org admin.
	const hasManage = can("schedules.manage");
	const isOrgAdmin = ["admin", "owner"].some((part) =>
		(role ?? "")
			.split(",")
			.map((segment) => segment.trim())
			.includes(part),
	);
	// `role` is null until the capabilities query settles — do not flash the
	// org-admin controls disabled in the meantime.
	const orgAdminOrLoading = isOrgAdmin || capabilitiesLoading;
	const canCreateHost = hasManage && isInstanceAdmin;
	const canCreateServer = hasManage && orgAdminOrLoading;
	const canCreate = canCreateHost || canCreateServer;
	const createHint = canCreate
		? undefined
		: hasManage
			? "Requires an organization or instance admin"
			: capabilityHint("schedules.manage");
	/** Row-level gate: the target kind decides which admin level applies. */
	const canManageRow = (schedule: ScheduleRow) =>
		hasManage &&
		(schedule.scheduleType === "nixploy-server"
			? isInstanceAdmin
			: schedule.scheduleType === "server"
				? orgAdminOrLoading
				: true);
	const rowHint = (schedule: ScheduleRow) =>
		canManageRow(schedule)
			? undefined
			: !hasManage
				? capabilityHint("schedules.manage")
				: schedule.scheduleType === "nixploy-server"
					? "Requires an instance administrator"
					: "Requires an organization admin";
	const defaultScheduleType: ScheduleType = canCreateHost ? "nixploy-server" : "server";

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<ScheduleRow | null>(null);
	// Typed explicitly: `defaultScheduleType` is narrowed to two members by the
	// assignment above, which would otherwise narrow the form's union too.
	const [form, setForm] = useState<typeof EMPTY_FORM>({
		...EMPTY_FORM,
		scheduleType: defaultScheduleType,
	});
	const [deleteTarget, setDeleteTarget] = useState<ScheduleRow | null>(null);

	const {
		data: schedules,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.schedule.all.queryOptions());

	const serversQuery = useQuery(trpc.server.all.queryOptions());

	const serverOptions = (serversQuery.data ?? []).map((server) => ({
		id: server.serverId,
		label: server.name,
	}));

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm({ ...EMPTY_FORM, scheduleType: defaultScheduleType });
		}
	}, [dialogOpen, defaultScheduleType]);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: trpc.schedule.all.queryKey() });

	const create = useMutation(
		trpc.schedule.create.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule created");
				setDialogOpen(false);
				invalidate();
			},
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const update = useMutation(
		trpc.schedule.update.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule updated");
				setDialogOpen(false);
				invalidate();
			},
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const remove = useMutation(
		trpc.schedule.remove.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule deleted");
				setDeleteTarget(null);
				invalidate();
			},
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const runNow = useMutation(
		trpc.schedule.runManually.mutationOptions({
			onSuccess: () => {
				toast.success("Schedule run completed");
				invalidate();
			},
			onError: (mutationError) => {
				toast.error(`Run failed: ${mutationError.message}`);
				invalidate();
			},
		}),
	);
	const setEnabled = useMutation(
		trpc.schedule.enable.mutationOptions({
			onSuccess: invalidate,
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);
	const setDisabled = useMutation(
		trpc.schedule.disable.mutationOptions({
			onSuccess: invalidate,
			onError: (mutationError) => toast.error(mutationError.message),
		}),
	);

	const saving = create.isPending || update.isPending;
	const needsTarget = form.scheduleType === "server";
	const targetAllowed =
		editing !== null || (form.scheduleType === "nixploy-server" ? canCreateHost : canCreateServer);
	const isValid =
		form.name.trim() !== "" &&
		looksLikeCron(form.cronExpression) &&
		form.command.trim() !== "" &&
		(!needsTarget || form.targetId.trim() !== "") &&
		targetAllowed;

	const presetValue = CRON_PRESETS.some((preset) => preset.value === form.cronExpression)
		? form.cronExpression
		: "custom";

	const openEdit = (schedule: ScheduleRow) => {
		setEditing(schedule);
		setForm({
			name: schedule.name,
			cronExpression: schedule.cronExpression,
			shellType: schedule.shellType,
			command: schedule.command,
			enabled: schedule.enabled,
			scheduleType: schedule.scheduleType,
			targetId: schedule.serverId ?? schedule.applicationId ?? schedule.composeId ?? "",
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
			return;
		}
		create.mutate({
			name: form.name,
			cronExpression: form.cronExpression,
			shellType: form.shellType,
			command: form.command,
			enabled: form.enabled,
			scheduleType: form.scheduleType,
			serverId: form.scheduleType === "server" ? form.targetId : null,
			applicationId: null,
			composeId: null,
		});
	};

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Schedules"
				description="Cron jobs for services, servers, and this host."
				actions={
					<Button
						size="sm"
						disabled={!canCreate}
						title={createHint}
						onClick={() => setDialogOpen(true)}
					>
						<Plus className="size-4" />
						Add Schedule
					</Button>
				}
			/>

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
						<Skeleton className="h-10 w-full" />
					</div>
				}
				empty={
					<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
						<CalendarClock className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No schedules yet.</p>
						<Button
							size="sm"
							variant="outline"
							disabled={!canCreate}
							title={createHint}
							onClick={() => setDialogOpen(true)}
						>
							<Plus className="size-4" />
							Add Schedule
						</Button>
					</div>
				}
			>
				<TableCard>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Target</TableHead>
								<TableHead>Cron</TableHead>
								<TableHead>Last run</TableHead>
								<TableHead>Enabled</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(schedules ?? []).map((schedule) => (
								<TableRow key={schedule.scheduleId}>
									<TableCell className="font-medium">{schedule.name}</TableCell>
									<TableCell>
										<div className="flex flex-col gap-0.5">
											<span>{schedule.targetName}</span>
											<span className="text-xs text-muted-foreground">{schedule.scheduleType}</span>
										</div>
									</TableCell>
									<TableCell className="font-mono text-xs">{schedule.cronExpression}</TableCell>
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
											// Double-clicks would otherwise queue enable + disable back to back.
											disabled={
												setEnabled.isPending || setDisabled.isPending || !canManageRow(schedule)
											}
											title={rowHint(schedule)}
											onCheckedChange={(enabled) =>
												enabled
													? setEnabled.mutate({ scheduleId: schedule.scheduleId })
													: setDisabled.mutate({ scheduleId: schedule.scheduleId })
											}
										/>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Run schedule now"
												title={rowHint(schedule) ?? "Run now"}
												disabled={runNow.isPending || !canManageRow(schedule)}
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
												disabled={!canManageRow(schedule)}
												title={rowHint(schedule)}
												onClick={() => openEdit(schedule)}
											>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete schedule"
												disabled={!canManageRow(schedule)}
												title={rowHint(schedule)}
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

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit schedule" : "Add schedule"}</DialogTitle>
						<DialogDescription>
							{editing
								? "Update the cron expression or command."
								: "Create a host or managed-server schedule. Application and compose schedules can also be added from each service."}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						{!editing && (
							<div className="grid gap-2">
								<Label>Target</Label>
								<Select
									value={form.scheduleType}
									onValueChange={(value) =>
										setForm({
											...form,
											scheduleType: value as ScheduleType,
											targetId: "",
										})
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{canCreateHost && (
											<SelectItem value="nixploy-server">This Nixploy host</SelectItem>
										)}
										<SelectItem value="server" disabled={!canCreateServer}>
											Managed server
										</SelectItem>
									</SelectContent>
								</Select>
								{!canCreateHost && (
									<p className="text-xs text-muted-foreground">
										Schedules on the Nixploy host itself are limited to instance administrators.
									</p>
								)}
							</div>
						)}
						{!editing && form.scheduleType === "server" && (
							<div className="grid gap-2">
								<Label>Server</Label>
								<Select
									value={form.targetId || undefined}
									onValueChange={(value) => setForm({ ...form, targetId: value })}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select server" />
									</SelectTrigger>
									<SelectContent>
										{serverOptions.map((server) => (
											<SelectItem key={server.id} value={server.id}>
												{server.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						<div className="grid gap-2">
							<Label htmlFor="schedule-name">Name</Label>
							<Input
								id="schedule-name"
								value={form.name}
								onChange={(event) => setForm({ ...form, name: event.target.value })}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Preset</Label>
							<Select
								value={presetValue}
								onValueChange={(value) => {
									if (value === "custom") return;
									setForm({ ...form, cronExpression: value });
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
						</div>
						<div className="grid gap-2">
							<Label htmlFor="schedule-cron">Cron</Label>
							<Input
								id="schedule-cron"
								value={form.cronExpression}
								onChange={(event) => setForm({ ...form, cronExpression: event.target.value })}
								className="font-mono text-sm"
							/>
						</div>
						<div className="grid gap-2">
							<Label>Shell</Label>
							<Select
								value={form.shellType}
								onValueChange={(value) => setForm({ ...form, shellType: value as "bash" | "sh" })}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="bash">bash</SelectItem>
									<SelectItem value="sh">sh</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="schedule-command">Command</Label>
							<Textarea
								id="schedule-command"
								value={form.command}
								onChange={(event) => setForm({ ...form, command: event.target.value })}
								rows={4}
								className="font-mono text-sm"
							/>
						</div>
						{!editing && (
							<div className="flex items-center justify-between gap-4">
								<Label htmlFor="schedule-enabled">Enabled</Label>
								<Switch
									id="schedule-enabled"
									checked={form.enabled}
									onCheckedChange={(enabled) => setForm({ ...form, enabled })}
								/>
							</div>
						)}
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button disabled={!isValid || saving} onClick={onSubmit}>
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							{editing ? "Save" : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={Boolean(deleteTarget)}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete schedule?</AlertDialogTitle>
						<AlertDialogDescription>
							Remove “{deleteTarget?.name}”? This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleteTarget) remove.mutate({ scheduleId: deleteTarget.scheduleId });
							}}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
