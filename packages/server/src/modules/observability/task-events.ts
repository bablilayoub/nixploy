import type { ServiceEventKind, ServiceEventSeverity } from "./event-kinds";

/**
 * Turning Swarm's task list into timeline events.
 *
 * Pure on purpose: the reconciler already fetches every task once a minute
 * (`loadSwarmSnapshot`), so the only thing left is a mapping — and a mapping
 * with this many edge cases (which states are failures, what exit 137 means,
 * what a rolling update looks like) deserves tests that need no daemon.
 */

/** The fields of a Swarm task this module reads, flattened out of dockerode's shape. */
export interface SwarmTaskFacts {
	/** Task id — stable for the task's whole life, which is what makes dedupe work. */
	id: string;
	/** `Spec.Name` of the service the task belongs to, resolved from `ServiceID`. */
	serviceName: string;
	/** Replica slot, or null for a global-mode task. */
	slot: number | null;
	/** `Status.State`, lower-cased. */
	state: string;
	/** `DesiredState`, lower-cased — what Swarm wants, vs. what `state` is. */
	desiredState: string;
	/** `Status.Message` ("started", "task shutdown", …). */
	message: string | null;
	/** `Status.Err` — set only when something went wrong. */
	error: string | null;
	/** `Status.ContainerStatus.ExitCode`, when the container actually ran. */
	exitCode: number | null;
	/** `Status.Timestamp` — when the state was entered, per the daemon. */
	timestamp: string | null;
}

/** A row {@link deriveTaskEvents} wants written, before a service/org is attached. */
export interface TaskEventDraft {
	serviceName: string;
	kind: ServiceEventKind;
	severity: ServiceEventSeverity;
	title: string;
	message: string | null;
	dedupeKey: string;
	occurredAt: Date | null;
	metadata: Record<string, unknown>;
}

/**
 * States that mean the task is gone and it was not our idea. `shutdown` and
 * `complete` are excluded deliberately: Swarm shuts tasks down on every
 * rolling update, and treating that as a failure would put a red row on the
 * timeline for each healthy deploy.
 */
const FAILED_STATES: ReadonlySet<string> = new Set(["failed", "rejected", "orphaned"]);

/**
 * 128 + SIGKILL(9). In a container this is the out-of-memory killer far more
 * often than anything else, but `docker kill` and a runtime that SIGKILLs on
 * a stop timeout produce it too — Swarm's task API carries no `OOMKilled`
 * flag to tell them apart (it is on the container, which is already gone).
 * So: classify it as a kill, and say in the row what the two causes are
 * rather than asserting one.
 */
export const SIGKILL_EXIT_CODE = 137;

/**
 * Did the daemon actually say the word? Then it is not a guess.
 *
 * Only the LEADING word boundary: the string Docker produces is `OOMKilled`,
 * with no boundary after "oom", while a trailing `\b` would also be needed to
 * keep "room"/"zoom" out — and the leading one already does that (there is no
 * boundary before "oom" in "room").
 */
const mentionsOom = (text: string | null): boolean => /\boom|out of memory/i.test(text ?? "");

/**
 * How far back a pass looks. A task whose state is older than this was seen
 * by an earlier pass (or predates the feature) and is not re-derived, which
 * is what keeps an every-minute pass from re-offering every task of every
 * service forever. The cost is that the first pass after an upgrade does not
 * backfill history — the timeline starts now.
 */
export const TASK_EVENT_LOOKBACK_MS = 30 * 60 * 1000;

/** Most events one service may contribute per pass; the overflow is reported, never silent. */
export const MAX_TASK_EVENTS_PER_SERVICE = 20;

const parseTimestamp = (value: string | null): Date | null => {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const describeSlot = (task: SwarmTaskFacts): string =>
	task.slot === null ? "" : ` (replica ${task.slot})`;

/** Short task id, the way `docker service ps` prints it. */
const shortId = (id: string): string => id.slice(0, 12);

function failureDraft(task: SwarmTaskFacts, occurredAt: Date | null): TaskEventDraft {
	const oomByName = mentionsOom(task.error) || mentionsOom(task.message);
	const sigkilled = task.exitCode === SIGKILL_EXIT_CODE;
	const metadata: Record<string, unknown> = {
		taskId: task.id,
		state: task.state,
		...(task.slot === null ? {} : { slot: task.slot }),
		...(task.exitCode === null ? {} : { exitCode: task.exitCode }),
		...(task.error ? { error: task.error } : {}),
	};

	if (oomByName || sigkilled) {
		return {
			serviceName: task.serviceName,
			kind: "oom_killed",
			severity: "error",
			title: `Task killed${describeSlot(task)}`,
			message: oomByName
				? `The container was killed by the out-of-memory killer${task.error ? `: ${task.error}` : "."}`
				: `The container was killed with SIGKILL (exit ${SIGKILL_EXIT_CODE}) — usually the out-of-memory killer, sometimes a stop that timed out. Raise the memory limit if this repeats.`,
			dedupeKey: `task:${task.id}:${task.state}`,
			occurredAt,
			metadata: { ...metadata, oomReported: oomByName },
		};
	}

	const exitText = task.exitCode === null ? "" : ` with exit code ${task.exitCode}`;
	return {
		serviceName: task.serviceName,
		kind: "task_failed",
		severity: "error",
		title: `Task ${task.state}${describeSlot(task)}`,
		message: task.error ?? `Task ${shortId(task.id)} ${task.state}${exitText}.`,
		dedupeKey: `task:${task.id}:${task.state}`,
		occurredAt,
		metadata,
	};
}

/**
 * One task → the event it deserves, or `null` when it is mid-flight or was
 * stopped on purpose.
 */
export function deriveTaskEvent(task: SwarmTaskFacts): TaskEventDraft | null {
	const occurredAt = parseTimestamp(task.timestamp);

	if (FAILED_STATES.has(task.state)) {
		return failureDraft(task, occurredAt);
	}

	if (task.state === "running") {
		// `desiredState: shutdown` on a running task is a rolling update
		// draining it — the replacement's own `running` is the event worth
		// having, not this one's brief overlap.
		if (task.desiredState === "shutdown" || task.desiredState === "remove") return null;
		return {
			serviceName: task.serviceName,
			kind: "task_started",
			severity: "info",
			title: `Task started${describeSlot(task)}`,
			message: null,
			dedupeKey: `task:${task.id}:running`,
			occurredAt,
			metadata: {
				taskId: task.id,
				...(task.slot === null ? {} : { slot: task.slot }),
			},
		};
	}

	// new / pending / assigned / preparing / starting: still on its way.
	// shutdown / complete / remove: we asked for it.
	return null;
}

export interface DeriveTaskEventsResult {
	drafts: TaskEventDraft[];
	/** Events dropped by {@link MAX_TASK_EVENTS_PER_SERVICE}, per service name. */
	dropped: Map<string, number>;
}

/**
 * Map a pass's task list onto timeline events.
 *
 * `now` is injected so the lookback window is testable. Within one service the
 * newest tasks win the per-pass budget: a service in a tight crash loop churns
 * through more tasks than Swarm's own history limit keeps, and the most recent
 * failure is the one someone is looking for.
 */
export function deriveTaskEvents(
	tasks: readonly SwarmTaskFacts[],
	now: number = Date.now(),
): DeriveTaskEventsResult {
	const cutoff = now - TASK_EVENT_LOOKBACK_MS;
	const byService = new Map<string, TaskEventDraft[]>();

	for (const task of tasks) {
		const draft = deriveTaskEvent(task);
		if (!draft) continue;
		// A task with no usable timestamp is kept: dropping it would lose a
		// failure, and the dedupe key stops it being recorded twice.
		if (draft.occurredAt && draft.occurredAt.getTime() < cutoff) continue;
		byService.set(draft.serviceName, [...(byService.get(draft.serviceName) ?? []), draft]);
	}

	const drafts: TaskEventDraft[] = [];
	const dropped = new Map<string, number>();
	for (const [serviceName, entries] of byService) {
		entries.sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0));
		if (entries.length > MAX_TASK_EVENTS_PER_SERVICE) {
			dropped.set(serviceName, entries.length - MAX_TASK_EVENTS_PER_SERVICE);
		}
		drafts.push(...entries.slice(0, MAX_TASK_EVENTS_PER_SERVICE));
	}
	return { drafts, dropped };
}
