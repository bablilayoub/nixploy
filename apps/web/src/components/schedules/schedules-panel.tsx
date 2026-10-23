"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { CalendarClock, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
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
import { TableCard } from "@/components/ui/table-card";
import { TableNoMatch, TablePagination, TableSearch } from "@/components/ui/table-toolbar";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTableView } from "@/hooks/use-table-view";
import { describeError } from "@/lib/describe-error";
import { scheduleRunStatusDot } from "@/lib/status";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GlobalScheduleRow = RouterOutputs["schedule"]["all"][number];
type ServiceScheduleRow = RouterOutputs["schedule"]["byService"][number];
/** Both queries return the same schedule columns; only `all` adds `targetName`. */
type ScheduleRow = GlobalScheduleRow | ServiceScheduleRow;

/** Module scope so the table view's memo is not invalidated every render. */
const searchSchedule = (row: ScheduleRow) => [
	row.name,
	row.cronExpression,
	row.command,
	"targetName" in row ? row.targetName : null,
];
type ScheduleType = GlobalScheduleRow["scheduleType"];

/**
 * Where the panel reads its rows from.
 *
 * - `global` — the `/dashboard/schedules` page: every schedule the caller can
 *   see, with a Target column and a target picker in the create dialog.
 * - `service` — the Advanced → Schedules tab of an application, a compose
 *   stack, a managed server or this host: the target is fixed.
 */
export type SchedulesSource =
	| { kind: "global" }
	| { kind: "service"; serviceType: ScheduleType; serviceId: string };

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
	scheduleType: "nixploy-server" as ScheduleType,
	targetId: "",
	/**
	 * `exec` runs the command inside a RUNNING container of the service;
	 * `image` runs it in a throwaway `docker run --rm` container, so a stopped
	 * service can still host a job (product audit, Platform row "No standalone
	 * job/cron service").
	 */
	runMode: "exec" as "exec" | "image",
	image: "",
};

type ScheduleForm = typeof EMPTY_FORM;

function targetIdOf(schedule: ScheduleRow): string {
	return schedule.serverId ?? schedule.applicationId ?? schedule.composeId ?? "";
}

function serviceDescription(serviceType: ScheduleType): string {
	if (serviceType === "nixploy-server") return "Cron shell jobs on this Nixploy host.";
	if (serviceType === "server") return "Cron shell jobs over SSH on the managed server.";
	return "Cron shell jobs inside the service container.";
}

/**
 * Cron schedules, in either placement (code-health F4: this used to be
 * `schedules-view.tsx` and `schedules-tab.tsx`, 79% identical).
 *
 * The differences kept from the two originals: the global placement owns the
 * page header, shows the Target column and lets the create dialog pick a
 * target; the service placement lives in a `SettingsSection`, shows the
 * Command column and pins the target to the service. Every capability gate
 * (`schedules.manage` plus instance-admin for host schedules and org-admin for
 * managed-server schedules) and the `(UTC)` cron labels are unchanged.
 */
export function SchedulesPanel({ source }: { source: SchedulesSource }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can, role, isInstanceAdmin, isLoading: capabilitiesLoading } = useCapabilities();
	const isGlobal = source.kind === "global";

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

	/** Admin level required by a target kind. */
	const allowsType = (scheduleType: ScheduleType) =>
		hasManage &&
		(scheduleType === "nixploy-server"
			? isInstanceAdmin
			: scheduleType === "server"
				? orgAdminOrLoading
				: true);
	const hintForType = (scheduleType: ScheduleType) =>
		allowsType(scheduleType)
			? undefined
			: !hasManage
				? capabilityHint("schedules.manage")
				: scheduleType === "nixploy-server"
					? "Requires an instance administrator"
					: "Requires an organization admin";

	const canCreateHost = allowsType("nixploy-server");
	const canCreateServer = allowsType("server");
	const canCreate = isGlobal ? canCreateHost || canCreateServer : allowsType(source.serviceType);
	const createHint = isGlobal
		? canCreate
			? undefined
			: hasManage
				? "Requires an organization or instance admin"
				: capabilityHint("schedules.manage")
		: hintForType(source.serviceType);
	const canManageRow = (schedule: ScheduleRow) =>
		isGlobal ? allowsType(schedule.scheduleType) : canCreate;
	const rowHint = (schedule: ScheduleRow) =>
		isGlobal ? hintForType(schedule.scheduleType) : createHint;
	const defaultScheduleType: ScheduleType = isGlobal
		? canCreateHost
			? "nixploy-server"
			: "server"
		: source.serviceType;

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<ScheduleRow | null>(null);
	// Typed explicitly: `defaultScheduleType` is narrowed to two members by the
	// assignment above, which would otherwise narrow the form's union too.
	const [form, setForm] = useState<ScheduleForm>({
		...EMPTY_FORM,
		scheduleType: defaultScheduleType,
	});
	const [deleteTarget, setDeleteTarget] = useState<ScheduleRow | null>(null);
	// "Run once from an image" — a job with no cron behind it.
	const [onceOpen, setOnceOpen] = useState(false);
	const [onceImage, setOnceImage] = useState("");
	const [onceCommand, setOnceCommand] = useState("");

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm({ ...EMPTY_FORM, scheduleType: defaultScheduleType });
		}
	}, [dialogOpen, defaultScheduleType]);

	// Two hooks rather than one conditional `queryOptions`: the two procedures
	// have different outputs (`all` adds `targetName`), which a single
	// `useQuery` call cannot type.
	const serviceInput = {
		serviceId: isGlobal ? "" : source.serviceId,
		serviceType: isGlobal ? ("application" as ScheduleType) : source.serviceType,
	};
	const globalQuery = useQuery({ ...trpc.schedule.all.queryOptions(), enabled: isGlobal });
	const serviceQuery = useQuery({
		...trpc.schedule.byService.queryOptions(serviceInput),
		enabled: !isGlobal,
	});
	const { isPending, isError, error, refetch } = isGlobal ? globalQuery : serviceQuery;
	const schedules: ScheduleRow[] = (isGlobal ? globalQuery.data : serviceQuery.data) ?? [];
	const view = useTableView({ rows: schedules, search: searchSchedule });
	const listKey = isGlobal
		? trpc.schedule.all.queryKey()
		: trpc.schedule.byService.queryKey(serviceInput);

	// Only the global placement offers a server picker.
	const serversQuery = useQuery({
		...trpc.server.all.queryOptions(),
		enabled: isGlobal,
	});
	const serverOptions = (serversQuery.data ?? []).map((server) => ({
		id: server.serverId,
		label: server.name,
	}));

	const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

	const create = useSaveMutation(
		trpc.schedule.create.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Schedule created", invalidate: [listKey] },
	);
	const update = useSaveMutation(
		trpc.schedule.update.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Schedule updated", invalidate: [listKey] },
	);
	const remove = useSaveMutation(
		trpc.schedule.remove.mutationOptions({ onSuccess: () => setDeleteTarget(null) }),
		{ successMessage: "Schedule deleted", invalidate: [listKey] },
	);
	// Not `useSaveMutation`: a failed run still updates `lastStatus`, so the
	// error path both re-labels the toast and refreshes the table.
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
	const setEnabled = useSaveMutation(trpc.schedule.enable.mutationOptions(), {
		invalidate: [listKey],
	});
	const setDisabled = useSaveMutation(trpc.schedule.disable.mutationOptions(), {
		invalidate: [listKey],
	});

	const saving = create.isPending || update.isPending;
	// Image jobs need the env and the overlay of a service; a shell on a
	// managed host has neither.
	const formScheduleType = isGlobal ? form.scheduleType : source.serviceType;
	const supportsImageMode = formScheduleType === "application" || formScheduleType === "compose";
	const runMode = supportsImageMode ? form.runMode : "exec";
	const needsTarget = isGlobal && form.scheduleType === "server";
	const targetAllowed = editing !== null || allowsType(form.scheduleType);
	const isValid =
		form.name.trim() !== "" &&
		looksLikeCron(form.cronExpression) &&
		form.command.trim() !== "" &&
		(runMode !== "image" || form.image.trim() !== "") &&
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
			targetId: targetIdOf(schedule),
			runMode: schedule.runMode,
			image: schedule.image ?? "",
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
				runMode,
				image: runMode === "image" ? form.image.trim() : null,
			});
			return;
		}
		const scheduleType = isGlobal ? form.scheduleType : source.serviceType;
		const targetId = isGlobal ? form.targetId : source.serviceId;
		create.mutate({
			name: form.name,
			cronExpression: form.cronExpression,
			shellType: form.shellType,
			command: form.command,
			enabled: form.enabled,
			scheduleType,
			runMode,
			image: runMode === "image" ? form.image.trim() : null,
			serverId: scheduleType === "server" ? targetId : null,
			applicationId: scheduleType === "application" ? targetId : null,
			composeId: scheduleType === "compose" ? targetId : null,
		});
	};

	/**
	 * A one-off job. Only offered where a service supplies the env and the
	 * overlay network (the global placement has no single target).
	 */
	const runOnce = useSaveMutation(trpc.schedule.runOnce.mutationOptions(), {
		invalidate: [listKey],
		errorMessage: "Run failed",
		onSuccess: (result) => {
			setOnceOpen(false);
			toast.success(
				result.output.trim()
					? `Job finished: ${result.output.trim().split("\n").slice(-1)[0]}`
					: "Job finished",
			);
		},
	});

	const canRunOnce = !isGlobal && supportsImageMode && canCreate;

	const addButton = (variant?: "outline") => (
		<div className="flex items-center gap-2">
			{canRunOnce ? (
				<Button size="sm" variant="outline" title={createHint} onClick={() => setOnceOpen(true)}>
					<Play className="size-4" />
					Run once
				</Button>
			) : null}
			<Button
				size="sm"
				variant={variant}
				disabled={!canCreate}
				title={createHint}
				onClick={() => setDialogOpen(true)}
			>
				<Plus className="size-4" />
				Add schedule
			</Button>
		</div>
	);

	const table = (
		<QueryState
			isPending={isPending}
			isError={isError}
			error={error}
			onRetry={() => refetch()}
			isEmpty={schedules.length === 0}
			skeleton={
				<div className="flex flex-col gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					{isGlobal ? <Skeleton className="h-10 w-full" /> : null}
				</div>
			}
			empty={
				isGlobal ? (
					<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
						<CalendarClock className="size-8 text-muted-foreground" />
						<p className="text-sm font-medium">No schedules yet</p>
						<p className="max-w-sm text-sm text-muted-foreground">
							Run a command on a cron: a database migration inside a service, a cleanup script on a
							server, or a job on this host.
						</p>
						{addButton("outline")}
					</div>
				) : (
					<EmptyState
						icon={CalendarClock}
						title="No schedules"
						description="Add a cron job to run a command on a schedule."
					/>
				)
			}
		>
			<TableCard
				framed={isGlobal}
				toolbar={<TableSearch view={view} placeholder="Search schedules…" className="ms-auto" />}
				footer={<TablePagination view={view} noun="schedules" />}
			>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							{isGlobal ? <TableHead>Target</TableHead> : null}
							<TableHead>{isGlobal ? "Cron" : "Schedule"}</TableHead>
							{isGlobal ? null : <TableHead>Command</TableHead>}
							<TableHead>Last run</TableHead>
							<TableHead>Enabled</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{view.visible.length === 0 ? <TableNoMatch view={view} colSpan={6} /> : null}
						{view.visible.map((schedule) => (
							<TableRow key={schedule.scheduleId}>
								<TableCell className={isGlobal ? "font-medium" : "max-w-40 truncate font-medium"}>
									<span className="flex items-center gap-2">
										<span className="truncate">{schedule.name}</span>
										{/* An image job runs in its own container — say so, it changes what the command can see. */}
										{schedule.runMode === "image" ? (
											<Badge
												variant="outline"
												className="shrink-0 text-[11px] font-normal"
												title={schedule.image ?? undefined}
											>
												Job
											</Badge>
										) : null}
									</span>
								</TableCell>
								{isGlobal ? (
									<TableCell>
										<div className="flex flex-col gap-0.5">
											<span>{"targetName" in schedule ? schedule.targetName : schedule.name}</span>
											<span className="text-xs text-muted-foreground">{schedule.scheduleType}</span>
										</div>
									</TableCell>
								) : null}
								<TableCell className="font-mono text-xs">{schedule.cronExpression}</TableCell>
								{isGlobal ? null : (
									<TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
										{schedule.command}
									</TableCell>
								)}
								<TableCell>
									{schedule.lastStatus ? (
										<span
											className="flex items-center gap-2 text-sm"
											title={schedule.lastError ?? undefined}
										>
											<StatusDot status={scheduleRunStatusDot[schedule.lastStatus] ?? "neutral"} />
											{schedule.lastRunAt ? (
												<DateTime value={schedule.lastRunAt} />
											) : (
												schedule.lastStatus
											)}
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
											{runNow.isPending && runNow.variables?.scheduleId === schedule.scheduleId ? (
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
	);

	const fields = (
		<>
			{isGlobal && !editing && (
				<div className="grid gap-2">
					<Label>Target</Label>
					<Select
						value={form.scheduleType}
						onValueChange={(value) =>
							setForm({ ...form, scheduleType: value as ScheduleType, targetId: "" })
						}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{canCreateHost && <SelectItem value="nixploy-server">This Nixploy host</SelectItem>}
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
			{needsTarget && !editing && (
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
					placeholder={isGlobal ? undefined : "Nightly cleanup"}
					value={form.name}
					onChange={(event) => setForm({ ...form, name: event.target.value })}
				/>
			</div>
			<div className="grid gap-2">
				<Label>{isGlobal ? "Preset" : "Cron expression (UTC)"}</Label>
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
				{isGlobal ? <Label htmlFor="schedule-cron">Cron (UTC)</Label> : null}
				<Input
					id="schedule-cron"
					className="font-mono text-sm"
					placeholder="0 0 * * *"
					value={form.cronExpression}
					onChange={(event) => setForm({ ...form, cronExpression: event.target.value })}
				/>
				{!isGlobal && !looksLikeCron(form.cronExpression) && (
					<p className="text-xs text-destructive">
						Expected 5 or 6 fields: [second] minute hour day month weekday.
					</p>
				)}
			</div>
			{supportsImageMode ? (
				<div className="grid gap-2">
					<Label htmlFor="schedule-run-mode">Runs in</Label>
					<Select
						value={form.runMode}
						onValueChange={(value) => setForm({ ...form, runMode: value as "exec" | "image" })}
					>
						<SelectTrigger id="schedule-run-mode">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="exec">The running container</SelectItem>
							<SelectItem value="image">A new container from an image</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">
						{form.runMode === "image"
							? "A throwaway container on this service's network, with its environment variables. Works while the service is stopped."
							: "Runs inside a container of this service — it has to be running."}
					</p>
				</div>
			) : null}
			{supportsImageMode && form.runMode === "image" ? (
				<div className="grid gap-2">
					<Label htmlFor="schedule-image">Image</Label>
					<Input
						id="schedule-image"
						className="font-mono text-sm"
						placeholder="alpine:3.20"
						value={form.image}
						onChange={(event) => setForm({ ...form, image: event.target.value })}
					/>
					<p className="text-xs text-muted-foreground">
						The image needs a shell — scratch and distroless images cannot run a job.
					</p>
				</div>
			) : null}
			<div className="grid gap-2">
				<Label htmlFor="schedule-shell">Shell</Label>
				<Select
					value={form.shellType}
					onValueChange={(value) => setForm({ ...form, shellType: value as "bash" | "sh" })}
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
			<div className="grid gap-2">
				<Label htmlFor="schedule-command">Command</Label>
				<Textarea
					id="schedule-command"
					className="font-mono text-sm"
					rows={isGlobal ? 4 : 3}
					placeholder={isGlobal ? undefined : "pg_dump -U postgres mydb > /backups/mydb.sql"}
					value={form.command}
					onChange={(event) => setForm({ ...form, command: event.target.value })}
				/>
			</div>
			{!editing &&
				(isGlobal ? (
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor="schedule-enabled">Enabled</Label>
						<Switch
							id="schedule-enabled"
							checked={form.enabled}
							onCheckedChange={(enabled) => setForm({ ...form, enabled })}
						/>
					</div>
				) : (
					<div className="flex items-center gap-2">
						<Switch
							id="schedule-enabled"
							checked={form.enabled}
							onCheckedChange={(enabled) => setForm({ ...form, enabled })}
						/>
						<Label htmlFor="schedule-enabled" className="font-normal">
							Enabled
						</Label>
					</div>
				))}
		</>
	);

	const submitButtons = (
		<>
			{isGlobal ? (
				<Button variant="outline" onClick={() => setDialogOpen(false)}>
					Cancel
				</Button>
			) : null}
			<Button
				type={isGlobal ? "button" : "submit"}
				disabled={!isValid || saving}
				onClick={isGlobal ? onSubmit : undefined}
			>
				{saving ? <Loader2 className="size-4 animate-spin" /> : null}
				{editing ? "Save" : "Create"}
			</Button>
		</>
	);

	const runOnceDialog = (
		<Dialog open={onceOpen} onOpenChange={setOnceOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Run once from an image</DialogTitle>
					<DialogDescription>
						Runs the command in a throwaway container on this service's network, with its
						environment variables. No schedule is created; the output lands in the service's run
						history.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="once-image">Image</Label>
						<Input
							id="once-image"
							className="font-mono text-sm"
							placeholder="alpine:3.20"
							value={onceImage}
							onChange={(event) => setOnceImage(event.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="once-command">Command</Label>
						<Textarea
							id="once-command"
							className="font-mono text-sm"
							rows={3}
							placeholder="npm run migrate"
							value={onceCommand}
							onChange={(event) => setOnceCommand(event.target.value)}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOnceOpen(false)}>
						Cancel
					</Button>
					<Button
						disabled={runOnce.isPending || onceImage.trim() === "" || onceCommand.trim() === ""}
						onClick={() =>
							runOnce.mutate({
								image: onceImage.trim(),
								command: onceCommand.trim(),
								applicationId:
									!isGlobal && source.serviceType === "application" ? source.serviceId : null,
								composeId: !isGlobal && source.serviceType === "compose" ? source.serviceId : null,
							})
						}
					>
						{runOnce.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
						Run now
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);

	const dialogs = (
		<>
			{runOnceDialog}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit schedule" : "Add schedule"}</DialogTitle>
						<DialogDescription>
							{isGlobal
								? editing
									? "Update the cron expression or command."
									: "Create a host or managed-server schedule. Application and compose schedules can also be added from each service."
								: "The command runs inside the service container on the given cron schedule."}
						</DialogDescription>
					</DialogHeader>
					{isGlobal ? (
						<>
							<div className="grid gap-4 py-2">{fields}</div>
							<DialogFooter>{submitButtons}</DialogFooter>
						</>
					) : (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								onSubmit();
							}}
							className="flex flex-col gap-4"
						>
							{fields}
							<DialogFooter>{submitButtons}</DialogFooter>
						</form>
					)}
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
							{isGlobal
								? `Remove “${deleteTarget?.name}”? This cannot be undone.`
								: `${deleteTarget?.name} will no longer run on its cron schedule.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant={isGlobal ? "destructive" : undefined}
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
		</>
	);

	if (isGlobal) {
		return (
			<div className="flex flex-col gap-6">
				<PageHeader
					title="Schedules"
					description="Cron jobs for services, servers, and this host."
					actions={addButton()}
				/>
				{table}
				{dialogs}
			</div>
		);
	}

	return (
		<>
			<SettingsSection
				wide
				title="Schedules"
				description={serviceDescription(source.serviceType)}
				actions={addButton()}
			>
				{table}
			</SettingsSection>
			{dialogs}
		</>
	);
}
