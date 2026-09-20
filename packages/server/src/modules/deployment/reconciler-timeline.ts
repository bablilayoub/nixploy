import { inArray } from "drizzle-orm";
import { db } from "../../db";
import { environments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import type { ServiceEventInput } from "../observability/service-events";
import { recordServiceEvents } from "../observability/service-events";
import { deriveTaskEvents } from "../observability/task-events";
import type { ServiceKind } from "../services/kinds";
import type { StatusCorrection, SwarmSnapshot } from "./reconciler";

const log = createLogger("status-reconciler");

/**
 * The service timeline's half of a reconcile pass.
 *
 * The pass already reads every Swarm service and task to correct statuses;
 * the same two API calls carry exit codes, error strings and task ids. This
 * turns them into `service_event` rows — the answer to "why did it restart?"
 * — without a second daemon round-trip or a cron of its own.
 *
 * Everything here is best-effort: a timeline write must never stop a pass
 * from correcting a status.
 */

/** A service row the pass already loaded, reduced to what the timeline needs. */
export interface TimelineService {
	serviceType: ServiceKind;
	serviceId: string;
	appName: string;
	environmentId: string;
}

/** Same, once its organization is known. */
export interface TimelineOwner extends TimelineService {
	organizationId: string;
}

/**
 * Swarm service name → the Nixploy service it belongs to.
 *
 * For applications and databases the swarm service name *is* the `appName`.
 * A compose stack is several swarm services (`<appName>_<svc>`), all carrying
 * the stack's namespace label, so each of them points back at the one compose
 * row. Names that map to nothing (`nixploy`, `nixploy-traefik`,
 * `nixploy-postgres`, anything an operator created by hand) are simply absent
 * — a task nobody owns produces no event.
 */
export function buildServiceNameIndex(
	owners: readonly TimelineOwner[],
	byStack: ReadonlyMap<string, string[]>,
): Map<string, TimelineOwner> {
	const index = new Map<string, TimelineOwner>();
	for (const owner of owners) {
		index.set(owner.appName, owner);
		if (owner.serviceType !== "compose") continue;
		for (const serviceName of byStack.get(owner.appName) ?? []) {
			index.set(serviceName, owner);
		}
	}
	return index;
}

/**
 * Which swarm service inside a stack a task belongs to, for the row's title.
 * `docker stack deploy` names services `<stack>_<service>`; anything else
 * (an application, a database) is the service itself and needs no suffix.
 */
export function composeServiceSuffix(swarmServiceName: string, appName: string): string | null {
	if (swarmServiceName === appName) return null;
	const prefix = `${appName}_`;
	return swarmServiceName.startsWith(prefix) ? swarmServiceName.slice(prefix.length) : null;
}

/**
 * Task events for one pass, attached to their owning service.
 *
 * Pure: {@link deriveTaskEvents} decides what a task means, this decides who
 * it belongs to. Tasks of a service Nixploy does not own are dropped here.
 */
export function buildTaskEventInputs(
	snapshot: SwarmSnapshot,
	index: ReadonlyMap<string, TimelineOwner>,
	now?: number,
): { inputs: ServiceEventInput[]; dropped: Map<string, number> } {
	// Only derive for tasks of services we own: a busy host runs platform and
	// operator services too, and mapping them costs nothing but noise.
	const owned = snapshot.tasks.filter((task) => index.has(task.serviceName));
	const { drafts, dropped } = deriveTaskEvents(owned, now);

	const inputs: ServiceEventInput[] = [];
	for (const draft of drafts) {
		const owner = index.get(draft.serviceName);
		if (!owner) continue;
		const suffix = composeServiceSuffix(draft.serviceName, owner.appName);
		inputs.push({
			organizationId: owner.organizationId,
			serviceType: owner.serviceType,
			serviceId: owner.serviceId,
			appName: owner.appName,
			kind: draft.kind,
			severity: draft.severity,
			// A stack's rows say which of its services died; a single-service
			// row would otherwise read the same for all of them.
			title: suffix ? `${draft.title} — ${suffix}` : draft.title,
			message: draft.message,
			// Dedupe is per service, and a stack's services share one row: keep
			// the swarm service name in the key so two tasks of one stack cannot
			// collide (task ids are unique, but the key is what the index sees).
			dedupeKey: `${draft.serviceName}:${draft.dedupeKey}`,
			occurredAt: draft.occurredAt,
			metadata: suffix ? { ...draft.metadata, service: suffix } : draft.metadata,
		});
	}
	return { inputs, dropped };
}

/** Severity of a drift correction: what the service ended up as. */
const CORRECTION_SEVERITY = {
	error: "error",
	idle: "warning",
	running: "info",
	done: "info",
} as const;

/**
 * Drift the reconciler had to correct, as timeline rows.
 *
 * These are exactly the cases the panel used to be silent about: a service
 * that stopped, crashed or came back without a deployment — a host reboot, a
 * `docker` CLI action, an OOM the deploy path never saw.
 */
export function buildCorrectionEventInputs(
	corrections: readonly StatusCorrection[],
	index: ReadonlyMap<string, TimelineOwner>,
): ServiceEventInput[] {
	const inputs: ServiceEventInput[] = [];
	for (const correction of corrections) {
		const owner = index.get(correction.appName);
		if (!owner || owner.serviceId !== correction.id) continue;
		inputs.push({
			organizationId: owner.organizationId,
			serviceType: owner.serviceType,
			serviceId: owner.serviceId,
			appName: owner.appName,
			kind: "status_changed",
			severity: CORRECTION_SEVERITY[correction.to] ?? "warning",
			title: `Status changed to ${correction.to}`,
			message: `Nixploy found this service ${correction.to} while the panel said ${correction.from}. Nothing deployed it — something changed it outside Nixploy, or a task died.`,
			metadata: { from: correction.from, to: correction.to, source: "reconciler" },
		});
	}
	return inputs;
}

/** Organization of each service, resolved through its environment in one query. */
export async function resolveTimelineOwners(
	services: readonly TimelineService[],
): Promise<TimelineOwner[]> {
	if (services.length === 0) return [];
	const environmentIds = [...new Set(services.map((service) => service.environmentId))];
	const rows = await db.query.environments.findMany({
		where: inArray(environments.environmentId, environmentIds),
		columns: { environmentId: true },
		with: { project: { columns: { organizationId: true } } },
	});
	const orgByEnvironment = new Map(
		rows.map((row) => [row.environmentId, row.project.organizationId]),
	);
	const owners: TimelineOwner[] = [];
	for (const service of services) {
		const organizationId = orgByEnvironment.get(service.environmentId);
		if (organizationId) owners.push({ ...service, organizationId });
	}
	return owners;
}

/**
 * Write the pass's timeline rows. Called once per reconcile pass with the
 * services it loaded, the snapshot it read and the corrections it made.
 *
 * Swarm-only: a plain (non-stack) compose deployment has no tasks to read, so
 * its timeline carries deploys, rollbacks and config changes but no
 * per-container rows.
 */
export async function recordReconciledEvents(input: {
	snapshot: SwarmSnapshot | null;
	services: readonly TimelineService[];
	corrections: readonly StatusCorrection[];
}): Promise<void> {
	try {
		const owners = await resolveTimelineOwners(input.services);
		const index = buildServiceNameIndex(owners, input.snapshot?.byStack ?? new Map());

		const inputs = buildCorrectionEventInputs(input.corrections, index);
		if (input.snapshot) {
			const tasks = buildTaskEventInputs(input.snapshot, index);
			inputs.push(...tasks.inputs);
			for (const [serviceName, count] of tasks.dropped) {
				// Never silent: a service churning through more tasks than one
				// pass records is exactly the service someone is investigating.
				log.warn(
					`Service "${serviceName}" produced more task events than one pass records — ${count} dropped`,
				);
			}
		}
		await recordServiceEvents(inputs);
	} catch (error) {
		log.error("Failed to record the pass's service events", {
			error: describeErrorWithCause(error),
		});
	}
}
