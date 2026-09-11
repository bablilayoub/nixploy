"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Loader2, Network, Plus, RotateCcw, Tag, Trash2, Waypoints } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { capabilityHint } from "@/components/services/capability-hint";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

/*
 * Forms for the Docker Swarm overrides the application router stores as
 * jsonb (`updateConfigSwarm`, `rollbackConfigSwarm`, `restartPolicySwarm`,
 * `modeSwarm`, `labelsSwarm`, `networkSwarm`). Shapes mirror the Engine API
 * (validated by `utils/swarm-overrides.ts`): PascalCase keys, durations in
 * nanoseconds — the forms speak seconds and convert. "Reset" stores `null`
 * so the deploy engine falls back to its defaults.
 */

const SECOND = 1_000_000_000;

type UpdateOrder = "start-first" | "stop-first";
/** `UpdateConfig.FailureAction`; a failed rollback cannot roll back again. */
type UpdateFailureAction = "continue" | "pause" | "rollback";
type RollbackFailureAction = Exclude<UpdateFailureAction, "rollback">;
type FailureAction = UpdateFailureAction | RollbackFailureAction;
type RestartCondition = "none" | "on-failure" | "any";

interface RolloutConfig {
	Parallelism?: number;
	Delay?: number;
	FailureAction?: FailureAction;
	Monitor?: number;
	MaxFailureRatio?: number;
	Order?: UpdateOrder;
}

interface RestartPolicy {
	Condition?: RestartCondition;
	Delay?: number;
	MaxAttempts?: number;
	Window?: number;
}

type ModeSwarm = { Replicated: { Replicas: number } } | { Global: Record<string, never> };

interface NetworkAttachment {
	Target: string;
	Aliases?: string[];
}

const toSeconds = (nanoseconds: number | undefined): string =>
	nanoseconds === undefined ? "" : String(nanoseconds / SECOND);
const toNanoseconds = (seconds: string): number | undefined => {
	const trimmed = seconds.trim();
	if (!trimmed) return undefined;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * SECOND) : undefined;
};
const toInteger = (value: string): number | undefined => {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const toRatio = (value: string): number | undefined => {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
};
const stripUndefined = <T extends object>(value: T): T =>
	Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

function useSaveOverride(applicationId: string, successMessage: string) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	return useMutation(
		trpc.application.update.mutationOptions({
			onSuccess: async () => {
				toast.success(successMessage);
				await queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
			},
			onError: (error) => toastError(error),
		}),
	);
}

function Field({
	id,
	label,
	hint,
	children,
}: {
	id: string;
	label: string;
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			{children}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

function FormFooter({
	dirty,
	pending,
	canWrite,
	onSave,
	onReset,
	resetLabel = "Reset to defaults",
	hasOverride,
}: {
	dirty: boolean;
	pending: boolean;
	canWrite: boolean;
	onSave: () => void;
	onReset: () => void;
	resetLabel?: string;
	/** Something is stored — enables Reset even when the form is clean. */
	hasOverride: boolean;
}) {
	const hint = canWrite ? undefined : capabilityHint("service.write");
	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			<UnsavedChangesPill dirty={dirty} />
			<DisabledHint hint={hint}>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending || !canWrite || !hasOverride}
					onClick={onReset}
				>
					<RotateCcw className="size-3.5" />
					{resetLabel}
				</Button>
			</DisabledHint>
			<DisabledHint hint={hint}>
				<Button type="button" size="sm" disabled={pending || !canWrite || !dirty} onClick={onSave}>
					{pending && <Loader2 className="size-4 animate-spin" />}
					Save
				</Button>
			</DisabledHint>
		</div>
	);
}

// ── Update / rollback config ─────────────────────────────────────────────────

function RolloutForm({
	application,
	field,
	title,
	description,
	icon,
	defaultOrder,
	failureActions,
}: {
	application: Application;
	field: "updateConfigSwarm" | "rollbackConfigSwarm";
	title: string;
	description: ReactNode;
	icon: ReactNode;
	defaultOrder: UpdateOrder;
	failureActions: { value: FailureAction; label: string }[];
}) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const stored = (application[field] as RolloutConfig | null) ?? null;
	const save = useSaveOverride(application.applicationId, `${title} saved`);

	const seed = (config: RolloutConfig | null) => ({
		parallelism: config?.Parallelism === undefined ? "" : String(config.Parallelism),
		delay: toSeconds(config?.Delay),
		failureAction: config?.FailureAction ?? "",
		monitor: toSeconds(config?.Monitor),
		maxFailureRatio: config?.MaxFailureRatio === undefined ? "" : String(config.MaxFailureRatio),
		order: config?.Order ?? "",
	});
	const [form, setForm] = useState(() => seed(stored));
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const storedKey = JSON.stringify(stored);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the stored override changes
	useEffect(() => {
		if (!dirty) setForm(seed(stored));
	}, [storedKey, dirty]);

	const set = (key: keyof typeof form) => (value: string) => {
		setDirty(true);
		setForm((current) => ({ ...current, [key]: value }));
	};

	const build = (): RolloutConfig | null => {
		const config = stripUndefined<RolloutConfig>({
			Parallelism: toInteger(form.parallelism),
			Delay: toNanoseconds(form.delay),
			FailureAction: (form.failureAction || undefined) as FailureAction | undefined,
			Monitor: toNanoseconds(form.monitor),
			MaxFailureRatio: toRatio(form.maxFailureRatio),
			Order: (form.order || undefined) as UpdateOrder | undefined,
		});
		return Object.keys(config).length > 0 ? config : null;
	};

	const prefix = field === "updateConfigSwarm" ? "update" : "rollback";

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					{icon}
					{title}
				</span>
			}
			description={description}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field
					id={`${prefix}-parallelism`}
					label="Parallelism"
					hint="Tasks updated at once. 0 updates all at once; default 1."
				>
					<Input
						id={`${prefix}-parallelism`}
						type="number"
						min={0}
						placeholder="1"
						value={form.parallelism}
						onChange={(e) => set("parallelism")(e.target.value)}
					/>
				</Field>
				<Field id={`${prefix}-delay`} label="Delay (seconds)" hint="Pause between task batches.">
					<Input
						id={`${prefix}-delay`}
						type="number"
						min={0}
						step="0.5"
						placeholder="0"
						value={form.delay}
						onChange={(e) => set("delay")(e.target.value)}
					/>
				</Field>
				<Field
					id={`${prefix}-failure`}
					label="On failure"
					hint="What Swarm does when a task fails to start during the rollout."
				>
					<Select
						value={form.failureAction || "__default__"}
						onValueChange={(value) => set("failureAction")(value === "__default__" ? "" : value)}
					>
						<SelectTrigger id={`${prefix}-failure`} className="w-full">
							<SelectValue placeholder="Default (pause)" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__default__">Default (pause)</SelectItem>
							{failureActions.map((action) => (
								<SelectItem key={action.value} value={action.value}>
									{action.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<Field
					id={`${prefix}-monitor`}
					label="Monitor (seconds)"
					hint="How long each task is watched for failure after starting."
				>
					<Input
						id={`${prefix}-monitor`}
						type="number"
						min={0}
						step="0.5"
						placeholder="5"
						value={form.monitor}
						onChange={(e) => set("monitor")(e.target.value)}
					/>
				</Field>
				<Field
					id={`${prefix}-ratio`}
					label="Max failure ratio"
					hint="0–1: share of failed tasks tolerated before the failure action fires."
				>
					<Input
						id={`${prefix}-ratio`}
						type="number"
						min={0}
						max={1}
						step="0.05"
						placeholder="0"
						value={form.maxFailureRatio}
						onChange={(e) => set("maxFailureRatio")(e.target.value)}
					/>
				</Field>
				<Field
					id={`${prefix}-order`}
					label="Order"
					hint={`start-first keeps the old task running until the new one is up (zero downtime); default ${defaultOrder}.`}
				>
					<Select
						value={form.order || "__default__"}
						onValueChange={(value) => set("order")(value === "__default__" ? "" : value)}
					>
						<SelectTrigger id={`${prefix}-order`} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__default__">Default ({defaultOrder})</SelectItem>
							<SelectItem value="start-first">start-first</SelectItem>
							<SelectItem value="stop-first">stop-first</SelectItem>
						</SelectContent>
					</Select>
				</Field>
			</div>
			<FormFooter
				dirty={dirty}
				pending={save.isPending}
				canWrite={canWrite}
				hasOverride={stored !== null}
				onSave={() =>
					save.mutate(
						{ applicationId: application.applicationId, [field]: build() },
						{ onSuccess: () => setDirty(false) },
					)
				}
				onReset={() =>
					save.mutate(
						{ applicationId: application.applicationId, [field]: null },
						{ onSuccess: () => setDirty(false) },
					)
				}
			/>
		</SettingsSection>
	);
}

// ── Restart policy ───────────────────────────────────────────────────────────

function RestartPolicyForm({ application }: { application: Application }) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const stored = (application.restartPolicySwarm as RestartPolicy | null) ?? null;
	const save = useSaveOverride(application.applicationId, "Restart policy saved");

	const seed = (policy: RestartPolicy | null) => ({
		condition: policy?.Condition ?? "",
		delay: toSeconds(policy?.Delay),
		maxAttempts: policy?.MaxAttempts === undefined ? "" : String(policy.MaxAttempts),
		window: toSeconds(policy?.Window),
	});
	const [form, setForm] = useState(() => seed(stored));
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const storedKey = JSON.stringify(stored);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the stored override changes
	useEffect(() => {
		if (!dirty) setForm(seed(stored));
	}, [storedKey, dirty]);

	const set = (key: keyof typeof form) => (value: string) => {
		setDirty(true);
		setForm((current) => ({ ...current, [key]: value }));
	};

	const build = (): RestartPolicy | null => {
		const policy = stripUndefined<RestartPolicy>({
			Condition: (form.condition || undefined) as RestartCondition | undefined,
			Delay: toNanoseconds(form.delay),
			MaxAttempts: toInteger(form.maxAttempts),
			Window: toNanoseconds(form.window),
		});
		return Object.keys(policy).length > 0 ? policy : null;
	};

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<RotateCcw className="size-4 text-muted-foreground" />
					Restart policy
				</span>
			}
			description="When Swarm restarts a task that exited. Default: restart on any exit, no attempt limit."
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field id="restart-condition" label="Condition">
					<Select
						value={form.condition || "__default__"}
						onValueChange={(value) => set("condition")(value === "__default__" ? "" : value)}
					>
						<SelectTrigger id="restart-condition" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__default__">Default (any)</SelectItem>
							<SelectItem value="any">any — always restart</SelectItem>
							<SelectItem value="on-failure">on-failure — non-zero exit only</SelectItem>
							<SelectItem value="none">none — never restart</SelectItem>
						</SelectContent>
					</Select>
				</Field>
				<Field id="restart-delay" label="Delay (seconds)" hint="Wait before each restart.">
					<Input
						id="restart-delay"
						type="number"
						min={0}
						step="0.5"
						placeholder="5"
						value={form.delay}
						onChange={(e) => set("delay")(e.target.value)}
					/>
				</Field>
				<Field
					id="restart-max"
					label="Max attempts"
					hint="Restarts allowed inside the window. Empty or 0 = unlimited."
				>
					<Input
						id="restart-max"
						type="number"
						min={0}
						placeholder="unlimited"
						value={form.maxAttempts}
						onChange={(e) => set("maxAttempts")(e.target.value)}
					/>
				</Field>
				<Field
					id="restart-window"
					label="Window (seconds)"
					hint="Period the attempt counter applies to. Empty = unbounded."
				>
					<Input
						id="restart-window"
						type="number"
						min={0}
						step="1"
						placeholder="unbounded"
						value={form.window}
						onChange={(e) => set("window")(e.target.value)}
					/>
				</Field>
			</div>
			<FormFooter
				dirty={dirty}
				pending={save.isPending}
				canWrite={canWrite}
				hasOverride={stored !== null}
				onSave={() =>
					save.mutate(
						{
							applicationId: application.applicationId,
							restartPolicySwarm: build(),
						},
						{ onSuccess: () => setDirty(false) },
					)
				}
				onReset={() =>
					save.mutate(
						{
							applicationId: application.applicationId,
							restartPolicySwarm: null,
						},
						{ onSuccess: () => setDirty(false) },
					)
				}
			/>
		</SettingsSection>
	);
}

// ── Mode ─────────────────────────────────────────────────────────────────────

function ModeForm({ application }: { application: Application }) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const stored = (application.modeSwarm as ModeSwarm | null) ?? null;
	const save = useSaveOverride(application.applicationId, "Service mode saved");

	const seed = (mode: ModeSwarm | null) => ({
		mode: mode && "Global" in mode ? "global" : mode ? "replicated" : "default",
		replicas:
			mode && "Replicated" in mode
				? String(mode.Replicated.Replicas)
				: String(application.replicas),
	});
	const [form, setForm] = useState(() => seed(stored));
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const storedKey = JSON.stringify(stored);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the stored override changes
	useEffect(() => {
		if (!dirty) setForm(seed(stored));
	}, [storedKey, dirty]);

	const build = (): ModeSwarm | null => {
		if (form.mode === "global") return { Global: {} };
		if (form.mode === "replicated") {
			return {
				Replicated: {
					Replicas: toInteger(form.replicas) ?? application.replicas,
				},
			};
		}
		return null;
	};

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<Layers className="size-4 text-muted-foreground" />
					Mode
				</span>
			}
			description="Replicated runs the configured number of tasks; global runs exactly one task on every eligible node (respecting placement constraints)."
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field id="mode-kind" label="Scheduling">
					<Select
						value={form.mode}
						onValueChange={(value) => {
							setDirty(true);
							setForm((current) => ({ ...current, mode: value }));
						}}
					>
						<SelectTrigger id="mode-kind" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="default">
								Default (replicated, {application.replicas} from Resources)
							</SelectItem>
							<SelectItem value="replicated">Replicated — fixed replica count</SelectItem>
							<SelectItem value="global">Global — one task per node</SelectItem>
						</SelectContent>
					</Select>
				</Field>
				{form.mode === "replicated" && (
					<Field
						id="mode-replicas"
						label="Replicas"
						hint="Overrides the replica count from the Resources card while this mode is stored."
					>
						<Input
							id="mode-replicas"
							type="number"
							min={0}
							value={form.replicas}
							onChange={(e) => {
								setDirty(true);
								setForm((current) => ({
									...current,
									replicas: e.target.value,
								}));
							}}
						/>
					</Field>
				)}
			</div>
			<FormFooter
				dirty={dirty}
				pending={save.isPending}
				canWrite={canWrite}
				hasOverride={stored !== null}
				onSave={() =>
					save.mutate(
						{ applicationId: application.applicationId, modeSwarm: build() },
						{ onSuccess: () => setDirty(false) },
					)
				}
				onReset={() =>
					save.mutate(
						{ applicationId: application.applicationId, modeSwarm: null },
						{ onSuccess: () => setDirty(false) },
					)
				}
			/>
		</SettingsSection>
	);
}

// ── Labels ───────────────────────────────────────────────────────────────────

interface LabelRow {
	id: number;
	key: string;
	value: string;
}

let labelRowId = 0;
const nextLabelRow = (key = "", value = ""): LabelRow => ({
	id: ++labelRowId,
	key,
	value,
});

function LabelsForm({ application }: { application: Application }) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const stored = (application.labelsSwarm as Record<string, string> | null) ?? null;
	const save = useSaveOverride(application.applicationId, "Service labels saved");

	const seed = (labels: Record<string, string> | null) =>
		Object.entries(labels ?? {}).map(([key, value]) => nextLabelRow(key, value));
	const [rows, setRows] = useState<LabelRow[]>(() => seed(stored));
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const storedKey = JSON.stringify(stored);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the stored override changes
	useEffect(() => {
		if (!dirty) setRows(seed(stored));
	}, [storedKey, dirty]);

	const update = (id: number, patch: Partial<LabelRow>) => {
		setDirty(true);
		setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
	};

	const build = (): Record<string, string> | null => {
		const labels: Record<string, string> = {};
		for (const row of rows) {
			const key = row.key.trim();
			if (key) labels[key] = row.value;
		}
		return Object.keys(labels).length > 0 ? labels : null;
	};

	const problem = rows.find((row) => row.key.trim().toLowerCase().startsWith("traefik."))
		? "traefik.* labels are managed by Nixploy and cannot be set here"
		: null;

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<Tag className="size-4 text-muted-foreground" />
					Service labels
				</span>
			}
			description="Labels on the Swarm service object (not the containers) — for your own tooling, monitoring exporters or placement by other services."
		>
			<div className="flex flex-col gap-2">
				{rows.length === 0 && <p className="text-sm text-muted-foreground">No labels.</p>}
				{rows.map((row) => (
					<div key={row.id} className="flex items-center gap-2">
						<Input
							aria-label="Label key"
							placeholder="com.example.team"
							className="font-mono text-xs"
							value={row.key}
							onChange={(e) => update(row.id, { key: e.target.value })}
						/>
						<span className="text-muted-foreground">=</span>
						<Input
							aria-label="Label value"
							placeholder="value"
							className="font-mono text-xs"
							value={row.value}
							onChange={(e) => update(row.id, { value: e.target.value })}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Remove label"
							onClick={() => {
								setDirty(true);
								setRows((current) => current.filter((item) => item.id !== row.id));
							}}
						>
							<Trash2 className="size-4 text-destructive" />
						</Button>
					</div>
				))}
				<div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={!canWrite}
						onClick={() => {
							setDirty(true);
							setRows((current) => [...current, nextLabelRow()]);
						}}
					>
						<Plus className="size-3.5" />
						Add label
					</Button>
				</div>
				{problem && <p className="text-xs text-destructive">{problem}</p>}
			</div>
			<FormFooter
				dirty={dirty}
				pending={save.isPending}
				canWrite={canWrite && !problem}
				hasOverride={stored !== null}
				resetLabel="Clear labels"
				onSave={() =>
					save.mutate(
						{ applicationId: application.applicationId, labelsSwarm: build() },
						{ onSuccess: () => setDirty(false) },
					)
				}
				onReset={() =>
					save.mutate(
						{ applicationId: application.applicationId, labelsSwarm: null },
						{ onSuccess: () => setDirty(false) },
					)
				}
			/>
		</SettingsSection>
	);
}

// ── Networks ─────────────────────────────────────────────────────────────────

function NetworksForm({ application }: { application: Application }) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const stored = (application.networkSwarm as NetworkAttachment[] | null) ?? null;
	const save = useSaveOverride(application.applicationId, "Networks saved");

	const seed = (attachments: NetworkAttachment[] | null) =>
		(attachments ?? []).map((attachment) => attachment.Target).join("\n");
	const [text, setText] = useState(() => seed(stored));
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const storedKey = JSON.stringify(stored);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the stored override changes
	useEffect(() => {
		if (!dirty) setText(seed(stored));
	}, [storedKey, dirty]);

	const targets = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const invalid = targets.find((target) => !/^nixploy-[a-zA-Z0-9_.-]+$/.test(target));
	const problem = invalid
		? `"${invalid}" is not allowed — only attachable networks named nixploy-* can be joined`
		: null;

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<Network className="size-4 text-muted-foreground" />
					Networks
				</span>
			}
			description={
				<>
					Extra overlay networks to attach, one per line. The shared{" "}
					<code className="font-mono text-xs">nixploy-network</code> is always attached; only
					attachable networks named <code className="font-mono text-xs">nixploy-*</code> are
					accepted (create them under Docker → Networks).
				</>
			}
		>
			<div className="grid gap-2">
				<Label htmlFor="swarm-networks">Networks</Label>
				<Textarea
					id="swarm-networks"
					className="min-h-24 font-mono text-xs"
					value={text}
					onChange={(event) => {
						setDirty(true);
						setText(event.target.value);
					}}
					placeholder={"nixploy-internal\nnixploy-metrics"}
					aria-invalid={problem ? true : undefined}
				/>
				{problem && <p className="text-xs text-destructive">{problem}</p>}
			</div>
			<FormFooter
				dirty={dirty}
				pending={save.isPending}
				canWrite={canWrite && !problem}
				hasOverride={stored !== null}
				resetLabel="Clear networks"
				onSave={() =>
					save.mutate(
						{
							applicationId: application.applicationId,
							networkSwarm:
								targets.length > 0 ? targets.map((target) => ({ Target: target })) : null,
						},
						{ onSuccess: () => setDirty(false) },
					)
				}
				onReset={() =>
					save.mutate(
						{ applicationId: application.applicationId, networkSwarm: null },
						{ onSuccess: () => setDirty(false) },
					)
				}
			/>
		</SettingsSection>
	);
}

/** Advanced → Swarm: rollout, rollback, restart, mode, labels and networks. */
export function SwarmConfig({ application }: { application: Application }) {
	return (
		<SettingsStack>
			<p className="text-sm text-muted-foreground">
				Raw Docker Swarm service settings — a wrong value can make a deploy hang or roll back.{" "}
				<HelpLink slug="deploy" />
			</p>
			<RolloutForm
				application={application}
				field="updateConfigSwarm"
				title="Rolling update"
				description="How a new image is rolled out across replicas. Defaults: one task at a time, start-first (the new task must be running before the old one stops)."
				icon={<Waypoints className="size-4 text-muted-foreground" />}
				defaultOrder="start-first"
				failureActions={[
					{
						value: "pause",
						label: "pause — stop the rollout, keep what is running",
					},
					{ value: "continue", label: "continue — keep rolling out" },
					{
						value: "rollback",
						label: "rollback — revert to the previous spec",
					},
				]}
			/>
			<RolloutForm
				application={application}
				field="rollbackConfigSwarm"
				title="Rollback"
				description="How Swarm reverts to the previous spec when a rollout fails (or you roll back manually). Defaults: one task at a time, stop-first."
				icon={<RotateCcw className="size-4 text-muted-foreground" />}
				defaultOrder="stop-first"
				failureActions={[
					{ value: "pause", label: "pause — stop the rollback" },
					{ value: "continue", label: "continue — keep rolling back" },
				]}
			/>
			<RestartPolicyForm application={application} />
			<ModeForm application={application} />
			<LabelsForm application={application} />
			<NetworksForm application={application} />
		</SettingsStack>
	);
}
