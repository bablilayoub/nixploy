/**
 * The service-event vocabulary, and the pure facts derived from it.
 *
 * This file has **no imports on purpose** (same contract as
 * `modules/services/kinds.ts`): the panel's timeline renders labels and
 * severities straight from here, so anything pulled in would land in the
 * browser bundle. Everything that needs Drizzle or the database lives in
 * `./service-events.ts`.
 */

/**
 * Every kind of fact the timeline records. Order is the order the filter
 * chips are offered in.
 *
 * Deliberately closed: a producer that wants a new kind adds it here, gets a
 * label and a severity, and the panel renders it without another change.
 * Nothing validates the column against this list in SQL — an older panel
 * reading a newer instance's row falls back to the raw kind rather than
 * dropping the row.
 */
export const SERVICE_EVENT_KINDS = [
	"deploy_started",
	"deploy_finished",
	"deploy_failed",
	"deploy_cancelled",
	"rollback",
	"task_started",
	"task_failed",
	"oom_killed",
	"status_changed",
	"config_changed",
	"scaled",
] as const;

export type ServiceEventKind = (typeof SERVICE_EVENT_KINDS)[number];

export type ServiceEventSeverity = "info" | "warning" | "error";

/** Human label for a kind (timeline rows, filter chips, chart annotations). */
export const SERVICE_EVENT_KIND_LABELS: Record<ServiceEventKind, string> = {
	deploy_started: "Deploy started",
	deploy_finished: "Deploy finished",
	deploy_failed: "Deploy failed",
	deploy_cancelled: "Deploy cancelled",
	rollback: "Rolled back",
	task_started: "Task started",
	task_failed: "Task failed",
	oom_killed: "Killed",
	status_changed: "Status changed",
	config_changed: "Config changed",
	scaled: "Scaled",
};

/** Default severity of a kind; a producer may raise it, never lower it silently. */
export const SERVICE_EVENT_KIND_SEVERITY: Record<ServiceEventKind, ServiceEventSeverity> = {
	deploy_started: "info",
	deploy_finished: "info",
	deploy_failed: "error",
	deploy_cancelled: "info",
	rollback: "warning",
	task_started: "info",
	task_failed: "error",
	oom_killed: "error",
	status_changed: "warning",
	config_changed: "info",
	scaled: "info",
};

const KIND_SET: ReadonlySet<string> = new Set(SERVICE_EVENT_KINDS);

/** Runtime guard for untrusted strings (REST query params, MCP inputs). */
export const isServiceEventKind = (value: unknown): value is ServiceEventKind =>
	typeof value === "string" && KIND_SET.has(value);

/**
 * Label for a kind, tolerating one this build does not know: a panel served
 * from an older bundle than the instance it talks to still renders the row.
 */
export const serviceEventKindLabel = (kind: string): string =>
	isServiceEventKind(kind) ? SERVICE_EVENT_KIND_LABELS[kind] : kind.replace(/_/g, " ");

const SEVERITIES: ReadonlySet<string> = new Set<ServiceEventSeverity>(["info", "warning", "error"]);

export const isServiceEventSeverity = (value: unknown): value is ServiceEventSeverity =>
	typeof value === "string" && SEVERITIES.has(value);

/**
 * The kinds worth drawing on the metrics charts. A deploy and a kill explain
 * a step in the CPU line; "config changed" does not, and annotating every
 * kind turns the chart into a picket fence.
 */
export const SERVICE_EVENT_CHART_KINDS: readonly ServiceEventKind[] = [
	"deploy_finished",
	"deploy_failed",
	"rollback",
	"task_failed",
	"oom_killed",
];
