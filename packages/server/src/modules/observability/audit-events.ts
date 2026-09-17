import { isServiceKind, type ServiceKind } from "../services/kinds";
import type { ServiceEventKind } from "./event-kinds";
import type { ServiceEventInput } from "./service-events";
import { recordServiceEvents } from "./service-events";

/**
 * The audit trail as a source of timeline rows.
 *
 * Every service mutation already writes exactly one audit row naming the
 * service it changed (`targetType` is the service kind, `targetId` its id).
 * That is the whole "what did a human change, and when" half of the timeline
 * — so it is read from there rather than duplicated at ~40 call sites, and a
 * router that starts auditing a new mutation gets a timeline row for free.
 *
 * Pure derivation + one writer, so the mapping is testable without a database.
 */

/** The audit fields this bridge reads. */
export interface AuditEventSource {
	organizationId?: string | null;
	actorId?: string | null;
	actorEmail?: string | null;
	/** Dot-namespaced, e.g. `application.update`. */
	action: string;
	targetType?: string | null;
	targetId?: string | null;
	targetName?: string | null;
	metadata?: Record<string, unknown> | null;
}

/**
 * Verbs that already have a better producer, or no reader.
 *
 * - `deploy` / `redeploy`: the worker writes `deploy_started` with the
 *   deployment id attached; an audit-derived twin would double every deploy.
 * - `delete`: the service is gone, and nothing can open its timeline.
 * - `cancelDeployment` / `killBuild`: the worker's `deploy_cancelled` says it.
 */
const IGNORED_VERBS: ReadonlySet<string> = new Set([
	"deploy",
	"redeploy",
	"redeployFromDeployment",
	"delete",
	"cancelDeployment",
	"killBuild",
]);

/** Verbs that are their own timeline kind rather than a plain config change. */
const VERB_KINDS: Readonly<Record<string, ServiceEventKind>> = {
	rollback: "rollback",
};

/** Human copy per verb; anything else falls back to the verb itself. */
const VERB_TITLES: Readonly<Record<string, string>> = {
	create: "Service created",
	update: "Settings changed",
	move: "Moved to another environment",
	duplicate: "Duplicated",
	rollback: "Rolled back",
	start: "Started",
	stop: "Stopped",
	reload: "Reloaded",
	saveEnvironment: "Environment variables changed",
	saveBuildType: "Build type changed",
	saveSource: "Source changed",
	saveComposeFile: "Compose file changed",
	saveMiddlewares: "Domain middlewares changed",
};

/** `"application.saveBuildType"` → `"saveBuildType"`. */
export const auditVerb = (action: string): string => action.slice(action.indexOf(".") + 1);

/**
 * Turn "portCreate" / "saveBuildType" into "port create" / "save build type"
 * for a verb with no hand-written title. Better than showing the raw camelCase
 * and better than showing nothing.
 */
const humanizeVerb = (verb: string): string => {
	const spaced = verb.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * The timeline row an audit entry deserves, or `null` when it names no
 * service, changes nothing worth a row, or duplicates a better producer.
 *
 * `metadata` is copied through as-is: audit metadata is already required to
 * be secret-free (`AuditEntry.metadata`), and re-filtering it here would only
 * hide the fact when that rule is broken upstream.
 */
export function serviceEventFromAudit(entry: AuditEventSource): ServiceEventInput | null {
	if (!entry.organizationId || !entry.targetId) return null;
	if (!isServiceKind(entry.targetType)) return null;
	const verb = auditVerb(entry.action);
	if (IGNORED_VERBS.has(verb)) return null;

	const kind: ServiceEventKind = VERB_KINDS[verb] ?? "config_changed";
	return {
		organizationId: entry.organizationId,
		serviceType: entry.targetType as ServiceKind,
		serviceId: entry.targetId,
		appName: entry.targetName ?? "",
		kind,
		title: VERB_TITLES[verb] ?? humanizeVerb(verb),
		message: null,
		actorId: entry.actorId ?? null,
		actorEmail: entry.actorEmail ?? null,
		metadata: { action: entry.action, ...(entry.metadata ?? {}) },
	};
}

/**
 * Mirror an audit entry onto the timeline. Called from `recordAudit` after
 * the audit row is written — fire-and-forget, and the writer swallows its own
 * failures, so a timeline problem can never fail the mutation or lose the
 * audit row that matters more.
 */
export async function mirrorAuditOntoTimeline(entry: AuditEventSource): Promise<void> {
	const event = serviceEventFromAudit(entry);
	if (!event) return;
	await recordServiceEvents([event]);
}
