import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { and, eq, inArray, sql } from "drizzle-orm";
import { CHANNELS, notify, type Subscription, subscribe } from "../../db/listen";
import { createLogger } from "../../lib/logger";
import { isSplitRole, isWorkerRole } from "../../lib/role";
import { describeErrorWithCause } from "../../utils/error-cause";
import type { ServiceKind } from "../services/kinds";
import { SERVICE_KINDS } from "../services/kinds";
import { deploymentEvents } from "./events";

/**
 * Platform event bus — the push half of "push instead of poll"
 * (architecture audit #14 / §4.5).
 *
 * One emitter carries four kinds of frame:
 * - `deployment` — every status transition of a deployment row
 *   (`queued → running → done | error | cancelled`),
 * - `queue` — how many jobs an organization currently has waiting,
 * - `service-status` — a correction written by the status reconciler,
 * - `service-event` — a service's timeline gained rows.
 *
 * Producers call {@link publishPlatformEvent}. Consumers are `/ws/events`
 * (which filters by the socket's organization) and, in the split, the panel's
 * own `deploymentEvents` re-emitter so the existing `/ws/deployment` log
 * stream keeps closing on `finish` exactly as before.
 *
 * Transport depends on `NIXPLOY_ROLE`:
 * - `all` — the in-process emitter is enough; nothing touches Postgres.
 * - `panel` / `worker` — the event is ALSO sent as a Postgres `NOTIFY` on
 *   {@link CHANNELS.events}, and the other process's bridge re-emits it
 *   locally. Payloads are tiny JSON frames; log chunks never travel this way
 *   (8000-byte cap, and a build log is megabytes — the file on the shared
 *   config volume stays the source of truth).
 *
 * Like `events.ts` and the queue, the emitter lives on `globalThis`: Next
 * evaluates `packages/server` twice (route chunks vs. `server.ts`), and two
 * emitters would mean frames that never reach the open sockets.
 */

const log = createLogger("deploy-events");

export interface DeploymentEventFrame {
	kind: "deployment";
	organizationId: string;
	deploymentId: string;
	appName: string | null;
	applicationId: string | null;
	composeId: string | null;
	status: string;
	/** 1-based position in its server's line while `queued`. */
	queuePosition?: number | null;
	isPreview?: boolean;
}

export interface QueueEventFrame {
	kind: "queue";
	organizationId: string;
	/** Deployments still `queued` for this organization. */
	depth: number;
}

export interface ServiceStatusEventFrame {
	kind: "service-status";
	organizationId: string;
	serviceKind: ServiceKind;
	id: string;
	status: string;
	appName?: string | null;
}

/**
 * A service's timeline gained rows (`modules/observability/service-events.ts`).
 *
 * Carries the batch's loudest event rather than every row: a crash loop must
 * not become one socket frame per failed task, and the panel only needs to
 * know the timeline moved to refetch its page.
 */
export interface ServiceEventFrame {
	kind: "service-event";
	organizationId: string;
	serviceKind: ServiceKind;
	serviceId: string;
	appName: string;
	/** A `ServiceEventKind`; a client that does not know it still refetches. */
	eventKind: string;
	/** info | warning | error */
	severity: string;
}

/**
 * An incident was filed or changed (`modules/observability`, `modules/remediation`).
 * The panel refetches the incident list — the tray shows open proposals from it.
 */
export interface IncidentEventFrame {
	kind: "incident";
	organizationId: string;
	incidentId: string;
	/** `remediation`, `deploy_failure`, … — a client that does not know it still refetches. */
	incidentKind: string;
}

export type PlatformEvent =
	| DeploymentEventFrame
	| QueueEventFrame
	| ServiceStatusEventFrame
	| ServiceEventFrame
	| IncidentEventFrame;

/** The event minus the field a client must never see. */
export type ClientFrame =
	| (Omit<DeploymentEventFrame, "organizationId"> & { kind: "deployment" })
	| (Omit<QueueEventFrame, "organizationId"> & { kind: "queue" })
	| (Omit<ServiceStatusEventFrame, "organizationId"> & { kind: "service-status" })
	| (Omit<ServiceEventFrame, "organizationId"> & { kind: "service-event" })
	| (Omit<IncidentEventFrame, "organizationId"> & { kind: "incident" });

/** Strip the tenant id before a frame goes out over a socket. */
export function toClientFrame(event: PlatformEvent): ClientFrame {
	const { organizationId: _organizationId, ...rest } = event;
	return rest as ClientFrame;
}

/* -------------------------------------------------------------------------- */
/*  Encode / decode                                                           */
/* -------------------------------------------------------------------------- */

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

const nullableString = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

/** JSON for the event itself (the payload of a {@link NotifyEnvelope}). */
export function encodePlatformEvent(event: PlatformEvent): string {
	return JSON.stringify(event);
}

/**
 * Identity of THIS process on the notify channel.
 *
 * Both halves of a split listen on `nixploy_events`, so a publisher also
 * receives its own notification back — and it already emitted the event
 * locally. Without this the panel invalidated every query twice per
 * transition (observed: duplicate `queued` and `queue` frames on one deploy).
 * The id never leaves the transport: it is not part of `PlatformEvent` and
 * never reaches a client frame.
 */
const PROCESS_ORIGIN: string = randomUUID();

export interface NotifyEnvelope {
	origin: string;
	event: PlatformEvent;
}

/** Wrap an event for the wire, stamped with this process's origin. */
export function encodeEventEnvelope(event: PlatformEvent, origin = PROCESS_ORIGIN): string {
	return JSON.stringify({ o: origin, e: event });
}

/**
 * Unwrap a wire payload. Returns `null` for anything unparseable or for a
 * frame kind this build does not understand — never throws inside the
 * listener. Also accepts a bare event (no envelope) so a mixed-version rollout
 * keeps working; such a payload has no origin and is always delivered.
 */
export function decodeEventEnvelope(payload: string): NotifyEnvelope | null {
	let raw: unknown;
	try {
		raw = JSON.parse(payload);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Record<string, unknown>;
	if (candidate.e && typeof candidate.e === "object") {
		const event = decodePlatformEvent(JSON.stringify(candidate.e));
		return event ? { origin: isNonEmptyString(candidate.o) ? candidate.o : "", event } : null;
	}
	const event = decodePlatformEvent(payload);
	return event ? { origin: "", event } : null;
}

/** True when this payload is the echo of something this process published. */
export function isOwnEnvelope(envelope: NotifyEnvelope, origin = PROCESS_ORIGIN): boolean {
	return envelope.origin !== "" && envelope.origin === origin;
}

/**
 * Parse a NOTIFY payload back into an event. Returns `null` for anything that
 * is not a frame this version understands — a newer worker publishing a kind
 * an older panel does not know must be ignored, never crash the listener.
 */
export function decodePlatformEvent(payload: string): PlatformEvent | null {
	let raw: unknown;
	try {
		raw = JSON.parse(payload);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Record<string, unknown>;
	if (!isNonEmptyString(candidate.organizationId)) return null;

	switch (candidate.kind) {
		case "deployment": {
			if (!isNonEmptyString(candidate.deploymentId) || !isNonEmptyString(candidate.status)) {
				return null;
			}
			return {
				kind: "deployment",
				organizationId: candidate.organizationId,
				deploymentId: candidate.deploymentId,
				appName: nullableString(candidate.appName),
				applicationId: nullableString(candidate.applicationId),
				composeId: nullableString(candidate.composeId),
				status: candidate.status,
				queuePosition: typeof candidate.queuePosition === "number" ? candidate.queuePosition : null,
				isPreview: candidate.isPreview === true,
			};
		}
		case "queue": {
			if (typeof candidate.depth !== "number" || !Number.isFinite(candidate.depth)) return null;
			return { kind: "queue", organizationId: candidate.organizationId, depth: candidate.depth };
		}
		case "service-status": {
			if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.status)) return null;
			if (!(SERVICE_KINDS as readonly string[]).includes(candidate.serviceKind as string)) {
				return null;
			}
			return {
				kind: "service-status",
				organizationId: candidate.organizationId,
				serviceKind: candidate.serviceKind as ServiceKind,
				id: candidate.id,
				status: candidate.status,
				appName: nullableString(candidate.appName),
			};
		}
		case "service-event": {
			if (!isNonEmptyString(candidate.serviceId) || !isNonEmptyString(candidate.eventKind)) {
				return null;
			}
			if (!(SERVICE_KINDS as readonly string[]).includes(candidate.serviceKind as string)) {
				return null;
			}
			return {
				kind: "service-event",
				organizationId: candidate.organizationId,
				serviceKind: candidate.serviceKind as ServiceKind,
				serviceId: candidate.serviceId,
				appName: isNonEmptyString(candidate.appName) ? candidate.appName : "",
				eventKind: candidate.eventKind,
				severity: isNonEmptyString(candidate.severity) ? candidate.severity : "info",
			};
		}
		case "incident": {
			if (!isNonEmptyString(candidate.incidentId) || !isNonEmptyString(candidate.incidentKind)) {
				return null;
			}
			return {
				kind: "incident",
				organizationId: candidate.organizationId,
				incidentId: candidate.incidentId,
				incidentKind: candidate.incidentKind,
			};
		}
		default:
			return null;
	}
}

/* -------------------------------------------------------------------------- */
/*  Local emitter                                                             */
/* -------------------------------------------------------------------------- */

interface BusState {
	emitter: EventEmitter;
	/** Subscriptions this process holds, so shutdown can release them. */
	subscriptions: Subscription[];
	bridgeStarted: boolean;
}

const globalForBus = globalThis as typeof globalThis & {
	__nixployPlatformEvents?: BusState;
};

const bus: BusState = globalForBus.__nixployPlatformEvents ?? {
	emitter: new EventEmitter(),
	subscriptions: [],
	bridgeStarted: false,
};

if (!globalForBus.__nixployPlatformEvents) {
	bus.emitter.setMaxListeners(500);
	globalForBus.__nixployPlatformEvents = bus;
}

const EVENT = "platform";

/** Subscribe to platform events in THIS process. Returns an unsubscribe fn. */
export function onPlatformEvent(listener: (event: PlatformEvent) => void): () => void {
	bus.emitter.on(EVENT, listener);
	return () => {
		bus.emitter.off(EVENT, listener);
	};
}

/** Emit locally only — used by the bridge when a frame arrived over NOTIFY. */
export function emitPlatformEventLocally(event: PlatformEvent): void {
	bus.emitter.emit(EVENT, event);
}

/** Live listener count (tests, `/api/ready`). */
export function platformEventListenerCount(): number {
	return bus.emitter.listenerCount(EVENT);
}

/**
 * Publish an event: always locally, and over Postgres when the roles are
 * split. Never throws — a bus hiccup must not fail a deployment; the UI falls
 * back to its (slow) poll.
 */
export async function publishPlatformEvent(event: PlatformEvent): Promise<void> {
	emitPlatformEventLocally(event);
	if (!isSplitRole()) return;
	try {
		await notify(CHANNELS.events, encodeEventEnvelope(event));
	} catch (error) {
		log.debug("Failed to publish platform event", {
			kind: event.kind,
			error: describeErrorWithCause(error),
		});
	}
}

/** Fire-and-forget wrapper for call sites that must not await the bus. */
export function publishPlatformEventDetached(event: PlatformEvent): void {
	void publishPlatformEvent(event);
}

/* -------------------------------------------------------------------------- */
/*  Deployment helpers                                                        */
/* -------------------------------------------------------------------------- */

interface DeploymentOwner {
	organizationId: string;
	appName: string | null;
	applicationId: string | null;
	composeId: string | null;
	isPreview: boolean;
}

/**
 * Which organization owns a deployment row. Resolved once per transition
 * (deployments are rare events) through the same application/compose →
 * environment → project chain every tenant-scoped query uses.
 */
export async function resolveDeploymentOwner(
	deploymentId: string,
): Promise<DeploymentOwner | null> {
	const { db } = await import("../../db");
	const { deployments } = await import("../../db/schema");
	const row = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
		columns: { appName: true, applicationId: true, composeId: true, isPreview: true },
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	const organizationId =
		row?.application?.environment.project.organizationId ??
		row?.compose?.environment.project.organizationId;
	if (!row || !organizationId) return null;
	return {
		organizationId,
		appName: row.appName,
		applicationId: row.applicationId,
		composeId: row.composeId,
		isPreview: row.isPreview,
	};
}

/**
 * Publish a deployment transition. Looks the owner up itself so callers (the
 * queue, the worker, `cancelDeployment`, boot recovery) stay one line.
 * Detached and best-effort: a failure here never changes the deployment.
 */
export async function publishDeploymentStatus(
	deploymentId: string,
	status: string,
	options: { queuePosition?: number | null } = {},
): Promise<void> {
	try {
		const owner = await resolveDeploymentOwner(deploymentId);
		if (!owner) return;
		await publishPlatformEvent({
			kind: "deployment",
			organizationId: owner.organizationId,
			deploymentId,
			appName: owner.appName,
			applicationId: owner.applicationId,
			composeId: owner.composeId,
			status,
			queuePosition: options.queuePosition ?? null,
			isPreview: owner.isPreview,
		});
		await publishQueueDepth(owner.organizationId);
	} catch (error) {
		log.debug("Failed to publish deployment status", {
			deploymentId,
			error: describeErrorWithCause(error),
		});
	}
}

/** Same, detached — the shape every producer actually uses. */
export function publishDeploymentStatusDetached(
	deploymentId: string,
	status: string,
	options: { queuePosition?: number | null } = {},
): void {
	void publishDeploymentStatus(deploymentId, status, options);
}

/**
 * How many jobs one organization has waiting. One indexed count over the
 * in-flight rows; published alongside every transition so the UI's queue badge
 * needs no timer of its own.
 */
export async function publishQueueDepth(organizationId: string): Promise<void> {
	try {
		const { db } = await import("../../db");
		const rows = (await db.execute(sql`
			select count(*)::int as depth
			from "deployment" d
			left join "application" a on a."application_id" = d."application_id"
			left join "compose" c on c."compose_id" = d."compose_id"
			join "environment" e
				on e."environment_id" = coalesce(a."environment_id", c."environment_id")
			join "project" p on p."project_id" = e."project_id"
			where d."status" = 'queued' and p."organization_id" = ${organizationId}
		`)) as unknown as { depth: number }[];
		await publishPlatformEvent({
			kind: "queue",
			organizationId,
			depth: Number(rows[0]?.depth ?? 0),
		});
	} catch (error) {
		log.debug("Failed to publish queue depth", {
			error: describeErrorWithCause(error),
		});
	}
}

/**
 * Publish the status corrections a reconciler pass wrote. Called by
 * `reconciler.ts` (which owns the pass) with its `StatusCorrection[]`; the org
 * is resolved from the correction's environment in one batched query.
 */
export async function publishServiceStatusCorrections(
	corrections: ReadonlyArray<{
		kind: string;
		id: string;
		appName: string;
		to: string;
		environmentId: string;
	}>,
): Promise<void> {
	if (corrections.length === 0) return;
	try {
		const { db } = await import("../../db");
		const { environments } = await import("../../db/schema");
		const environmentIds = [...new Set(corrections.map((row) => row.environmentId))];
		const rows = await db.query.environments.findMany({
			where: inArray(environments.environmentId, environmentIds),
			columns: { environmentId: true },
			with: { project: { columns: { organizationId: true } } },
		});
		const orgByEnvironment = new Map(
			rows.map((row) => [row.environmentId, row.project.organizationId]),
		);
		for (const correction of corrections) {
			const organizationId = orgByEnvironment.get(correction.environmentId);
			if (!organizationId) continue;
			if (!(SERVICE_KINDS as readonly string[]).includes(correction.kind)) continue;
			await publishPlatformEvent({
				kind: "service-status",
				organizationId,
				serviceKind: correction.kind as ServiceKind,
				id: correction.id,
				status: correction.to,
				appName: correction.appName,
			});
		}
	} catch (error) {
		log.debug("Failed to publish service status corrections", {
			error: describeErrorWithCause(error),
		});
	}
}

/* -------------------------------------------------------------------------- */
/*  Queue wake-ups and cancellation                                           */
/* -------------------------------------------------------------------------- */

export interface QueuedNotice {
	deploymentId: string;
	serverId: string | null;
}

export function encodeQueuedNotice(notice: QueuedNotice): string {
	return JSON.stringify(notice);
}

export function decodeQueuedNotice(payload: string): QueuedNotice | null {
	try {
		const raw = JSON.parse(payload) as Record<string, unknown>;
		if (!isNonEmptyString(raw.deploymentId)) return null;
		return { deploymentId: raw.deploymentId, serverId: nullableString(raw.serverId) };
	} catch {
		return null;
	}
}

export interface CancelNotice {
	deploymentId: string;
}

export function encodeCancelNotice(notice: CancelNotice): string {
	return JSON.stringify(notice);
}

export function decodeCancelNotice(payload: string): CancelNotice | null {
	try {
		const raw = JSON.parse(payload) as Record<string, unknown>;
		return isNonEmptyString(raw.deploymentId) ? { deploymentId: raw.deploymentId } : null;
	} catch {
		return null;
	}
}

/**
 * Tell the worker a row is waiting. In role `all` the in-process `enqueued`
 * event already did that, so this is a no-op there.
 */
export async function notifyDeployQueued(notice: QueuedNotice): Promise<void> {
	if (!isSplitRole()) return;
	try {
		await notify(CHANNELS.deployQueued, encodeQueuedNotice(notice));
	} catch (error) {
		// The claim loop's slow poll is the fallback; a lost wake-up costs
		// latency, never correctness.
		log.debug("Failed to notify the worker about a queued deployment", {
			deploymentId: notice.deploymentId,
			error: describeErrorWithCause(error),
		});
	}
}

/** Ask whichever process is building `deploymentId` to kill it. */
export async function notifyDeployCancel(deploymentId: string): Promise<void> {
	if (!isSplitRole()) return;
	await notify(CHANNELS.deployCancel, encodeCancelNotice({ deploymentId })).catch(
		(error: unknown) => {
			log.debug("Failed to notify the worker about a cancellation", {
				deploymentId,
				error: describeErrorWithCause(error),
			});
		},
	);
}

/* -------------------------------------------------------------------------- */
/*  Bridges                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Start the cross-process bridge for this role. Idempotent, and a no-op for
 * role `all` (nothing to bridge — every producer and consumer is in-process).
 *
 * - **panel**: listens on `nixploy_events`, re-emits each frame locally AND
 *   mirrors terminal deployment transitions onto `deploymentEvents` so
 *   `/ws/deployment` closes its log stream exactly as it does today.
 * - **worker**: listens on `nixploy_deploy_queued` (→ poke the claim loop) and
 *   `nixploy_deploy_cancel` (→ kill the build it is running).
 */
export async function startEventBridge(): Promise<void> {
	if (bus.bridgeStarted || !isSplitRole()) return;
	bus.bridgeStarted = true;

	const onError = (error: unknown) =>
		log.error("Platform event bridge error", {
			error: describeErrorWithCause(error),
		});

	try {
		if (isWorkerRole()) {
			const { pokeQueue, requestCancellation } = await import("./queue");
			bus.subscriptions.push(
				await subscribe(
					CHANNELS.deployQueued,
					(payload) => {
						if (decodeQueuedNotice(payload)) pokeQueue();
					},
					// A reconnect may have hidden an enqueue: sweep once.
					{ onReconnect: () => pokeQueue(), onError },
				),
			);
			bus.subscriptions.push(
				await subscribe(
					CHANNELS.deployCancel,
					(payload) => {
						const notice = decodeCancelNotice(payload);
						if (!notice) return;
						const found = requestCancellation(notice.deploymentId, "user");
						log.info("Cancellation requested over NOTIFY", {
							deploymentId: notice.deploymentId,
							found: found ?? "not-running-here",
						});
					},
					{ onError },
				),
			);
		}

		// Both halves consume the event channel: the panel to feed `/ws/events`
		// and `/ws/deployment`, the worker so a cancel the panel finalized (a
		// queued row) still reaches anything listening inside the worker.
		bus.subscriptions.push(
			await subscribe(
				CHANNELS.events,
				(payload) => {
					const envelope = decodeEventEnvelope(payload);
					// Our own publish coming back: it was already emitted locally,
					// and delivering it twice means two invalidations per frame.
					if (!envelope || isOwnEnvelope(envelope)) return;
					emitPlatformEventLocally(envelope.event);
					mirrorOntoDeploymentEvents(envelope.event);
				},
				{ onError },
			),
		);
		log.info("Platform event bridge started");
	} catch (error) {
		bus.bridgeStarted = false;
		log.error("Failed to start the platform event bridge", {
			error: describeErrorWithCause(error),
		});
	}
}

/**
 * Terminal transitions that arrived from another process are re-emitted on the
 * local `deploymentEvents` bus so `/ws/deployment` — which only knows about
 * `finish` — keeps working unchanged in the split. `queued`/`running` are not
 * mirrored: nothing listens for them there.
 */
function mirrorOntoDeploymentEvents(event: PlatformEvent): void {
	if (event.kind !== "deployment") return;
	if (event.status === "queued" || event.status === "running") return;
	deploymentEvents.emit("finish", {
		deploymentId: event.deploymentId,
		status: event.status as "done" | "error" | "cancelled",
	});
}

/** Release the bridge's subscriptions (graceful shutdown). */
export async function stopEventBridge(): Promise<void> {
	const subscriptions = bus.subscriptions.splice(0);
	bus.bridgeStarted = false;
	await Promise.all(subscriptions.map((entry) => entry.unsubscribe()));
	// `unlisten` releases the channels but leaves the dedicated `max: 1`
	// listener connection open; close it too so a SIGTERM does not leave a
	// half-open session on Postgres (`db/listen.ts` reopens it lazily).
	const { closeListener } = await import("../../db/listen");
	await closeListener();
}

/**
 * Cancellation fallback for the split. The panel cannot see the worker's child
 * processes, so `cancelDeployment` NOTIFYs and returns; if the worker never
 * picks it up (it crashed, or the row is a zombie left by an earlier crash)
 * the row would stay `running` forever. After a short grace the panel
 * finalizes it itself — the same repair boot recovery would do, just sooner.
 */
export const CANCEL_ACK_GRACE_MS = 8_000;

export async function finalizeUnacknowledgedCancel(deploymentId: string): Promise<boolean> {
	const { db } = await import("../../db");
	const { deployments } = await import("../../db/schema");
	const rows = await db
		.update(deployments)
		.set({ status: "cancelled", finishedAt: new Date() })
		.where(and(eq(deployments.deploymentId, deploymentId), eq(deployments.status, "running")))
		.returning({ deploymentId: deployments.deploymentId });
	if (rows.length === 0) return false;
	deploymentEvents.emit("finish", { deploymentId, status: "cancelled" });
	publishDeploymentStatusDetached(deploymentId, "cancelled");
	return true;
}
