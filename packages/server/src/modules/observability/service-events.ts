import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { serviceEvents } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { publishPlatformEventDetached } from "../deployment/notify";
import { isServiceKind, type ServiceKind } from "../services/kinds";
import {
	SERVICE_EVENT_KIND_SEVERITY,
	type ServiceEventKind,
	type ServiceEventSeverity,
} from "./event-kinds";

const log = createLogger("service-events");

/**
 * The service timeline: write, read and retention.
 *
 * Producers are the reconciler (`deployment/reconciler.ts`), the deploy worker
 * (`deployment/worker.ts`) and the audit bridge (`audit/service-events.ts`).
 * Nothing here ever throws at a producer: a timeline write that fails must not
 * fail the deploy, the reconcile pass or the mutation it describes.
 */

/** Longest stored title / message. Docker error strings have no upper bound. */
const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;

const clamp = (value: string, max: number): string =>
	value.length <= max ? value : `${value.slice(0, max - 1)}…`;

export interface ServiceEventInput {
	organizationId: string;
	serviceType: ServiceKind;
	serviceId: string;
	appName: string;
	kind: ServiceEventKind;
	/** Defaults to the kind's own severity. */
	severity?: ServiceEventSeverity;
	title: string;
	message?: string | null;
	deploymentId?: string | null;
	actorId?: string | null;
	actorEmail?: string | null;
	/**
	 * Makes the write idempotent per service. Producers that can be replayed
	 * (the reconciler re-reads the same finished task every pass) must set it;
	 * one-shot producers leave it null.
	 */
	dedupeKey?: string | null;
	/** Exit codes, task ids, changed field names. Never a secret value. */
	metadata?: Record<string, unknown> | null;
	/** When it happened, if that differs from now. */
	occurredAt?: Date | null;
}

export type ServiceEventRow = typeof serviceEvents.$inferSelect;

const toValues = (input: ServiceEventInput) => ({
	organizationId: input.organizationId,
	serviceType: input.serviceType,
	serviceId: input.serviceId,
	appName: input.appName,
	kind: input.kind,
	severity: input.severity ?? SERVICE_EVENT_KIND_SEVERITY[input.kind] ?? "info",
	title: clamp(input.title, MAX_TITLE_LENGTH),
	message: input.message ? clamp(input.message, MAX_MESSAGE_LENGTH) : null,
	deploymentId: input.deploymentId ?? null,
	actorId: input.actorId ?? null,
	actorEmail: input.actorEmail ?? null,
	dedupeKey: input.dedupeKey ?? null,
	metadata: input.metadata ?? null,
	occurredAt: input.occurredAt ?? new Date(),
});

/**
 * Append events to the timeline and push one frame per service that actually
 * gained a row.
 *
 * Rows whose `(serviceId, dedupeKey)` already exists are dropped by the unique
 * index, so a caller may hand the same derivation the same tasks every minute
 * — only the first pass writes, and only that pass pushes a frame.
 */
export async function recordServiceEvents(inputs: readonly ServiceEventInput[]): Promise<number> {
	if (inputs.length === 0) return 0;
	try {
		const inserted = await db
			.insert(serviceEvents)
			.values(inputs.map(toValues))
			.onConflictDoNothing({ target: [serviceEvents.serviceId, serviceEvents.dedupeKey] })
			.returning({
				organizationId: serviceEvents.organizationId,
				serviceType: serviceEvents.serviceType,
				serviceId: serviceEvents.serviceId,
				appName: serviceEvents.appName,
				kind: serviceEvents.kind,
				severity: serviceEvents.severity,
			});

		// One frame per service, carrying the loudest event of the batch: the
		// panel only needs to know its timeline moved, and a crash loop must not
		// turn into one socket frame per failed task.
		const byService = new Map<string, (typeof inserted)[number]>();
		for (const row of inserted) {
			const current = byService.get(row.serviceId);
			if (!current || severityRank(row.severity) > severityRank(current.severity)) {
				byService.set(row.serviceId, row);
			}
		}
		for (const row of byService.values()) {
			if (!isServiceKind(row.serviceType)) continue;
			publishPlatformEventDetached({
				kind: "service-event",
				organizationId: row.organizationId,
				serviceKind: row.serviceType,
				serviceId: row.serviceId,
				appName: row.appName,
				eventKind: row.kind,
				severity: row.severity,
			});
		}
		return inserted.length;
	} catch (error) {
		log.error("Failed to record service events", {
			count: inputs.length,
			error: describeErrorWithCause(error),
		});
		return 0;
	}
}

const severityRank = (severity: string): number =>
	severity === "error" ? 2 : severity === "warning" ? 1 : 0;

/** One event. Convenience over {@link recordServiceEvents}; never throws. */
export async function recordServiceEvent(input: ServiceEventInput): Promise<void> {
	await recordServiceEvents([input]);
}

/** Fire-and-forget: the shape most producers on a hot path want. */
export function recordServiceEventDetached(input: ServiceEventInput): void {
	void recordServiceEvent(input);
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                   */
/* -------------------------------------------------------------------------- */

export const SERVICE_EVENT_PAGE_SIZE = 50;

export interface ListServiceEventsOptions {
	organizationId: string;
	serviceId: string;
	/** Restrict to these kinds; omit for all of them. */
	kinds?: readonly string[];
	/** Only events at or after this instant (the charts' visible window). */
	since?: Date;
	limit?: number;
	/** Keyset cursor from a previous page ({@link encodeServiceEventCursor}). */
	cursor?: string | null;
}

export interface ServiceEventPage {
	events: ServiceEventRow[];
	/** Cursor for the next (older) page, or null at the end of the timeline. */
	nextCursor: string | null;
}

/**
 * `occurredAt` is not unique — one reconcile pass writes several rows with the
 * daemon's identical timestamps — so the cursor carries the id as a tiebreak
 * and the page boundary is `(occurredAt, serviceEventId)`, not an offset.
 */
export const encodeServiceEventCursor = (row: {
	occurredAt: Date;
	serviceEventId: string;
}): string => `${row.occurredAt.toISOString()}|${row.serviceEventId}`;

export function decodeServiceEventCursor(
	cursor: string,
): { occurredAt: Date; serviceEventId: string } | null {
	const separator = cursor.indexOf("|");
	if (separator <= 0) return null;
	const occurredAt = new Date(cursor.slice(0, separator));
	const serviceEventId = cursor.slice(separator + 1);
	if (Number.isNaN(occurredAt.getTime()) || !serviceEventId) return null;
	return { occurredAt, serviceEventId };
}

/**
 * One page of a service's timeline, newest first. Always filtered by
 * organization as well as by service: `serviceId` is a polymorphic column with
 * no foreign key, so it is the org predicate that makes the read tenant-safe.
 */
export async function listServiceEvents(
	options: ListServiceEventsOptions,
): Promise<ServiceEventPage> {
	const limit = Math.min(Math.max(options.limit ?? SERVICE_EVENT_PAGE_SIZE, 1), 200);
	const conditions = [
		eq(serviceEvents.organizationId, options.organizationId),
		eq(serviceEvents.serviceId, options.serviceId),
	];
	if (options.kinds && options.kinds.length > 0) {
		conditions.push(inArray(serviceEvents.kind, [...options.kinds]));
	}
	if (options.since) {
		conditions.push(gte(serviceEvents.occurredAt, options.since));
	}
	const cursor = options.cursor ? decodeServiceEventCursor(options.cursor) : null;
	const olderThanCursor = cursor
		? or(
				lt(serviceEvents.occurredAt, cursor.occurredAt),
				and(
					eq(serviceEvents.occurredAt, cursor.occurredAt),
					lt(serviceEvents.serviceEventId, cursor.serviceEventId),
				),
			)
		: undefined;

	const rows = await db.query.serviceEvents.findMany({
		where: and(...conditions, olderThanCursor),
		orderBy: [desc(serviceEvents.occurredAt), desc(serviceEvents.serviceEventId)],
		limit: limit + 1,
	});

	const events = rows.slice(0, limit);
	const last = events.at(-1);
	return {
		events,
		nextCursor: rows.length > limit && last ? encodeServiceEventCursor(last) : null,
	};
}

/* -------------------------------------------------------------------------- */
/*  Retention                                                                 */
/* -------------------------------------------------------------------------- */

/** Timeline rows older than this go, whatever the per-service count. */
export const SERVICE_EVENT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Newest rows always kept per service, so a quiet service keeps its history. */
export const SERVICE_EVENTS_KEPT_PER_SERVICE = 1000;

/**
 * Drop events past {@link SERVICE_EVENT_MAX_AGE_MS}, and anything beyond the
 * newest {@link SERVICE_EVENTS_KEPT_PER_SERVICE} of a service — a service in a
 * crash loop writes a row every few seconds, and the per-service cap is what
 * stops one sick service from owning the table. Rows of services that no
 * longer exist are dropped by the age pass: `service_id` is polymorphic, so
 * there is no FK to cascade them away with the row.
 *
 * The cutoff is passed as an ISO string with an explicit cast — `db.execute`
 * runs through postgres-js's unsafe path, which cannot serialize a JS `Date`.
 */
export async function pruneServiceEvents(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - SERVICE_EVENT_MAX_AGE_MS);
	const aged = await db
		.delete(serviceEvents)
		.where(lt(serviceEvents.occurredAt, cutoff))
		.returning({ serviceEventId: serviceEvents.serviceEventId });

	const capped = (await db.execute(sql`
		WITH ranked AS (
			SELECT service_event_id,
				row_number() OVER (
					PARTITION BY service_id
					ORDER BY occurred_at DESC, service_event_id DESC
				) AS position
			FROM service_event
		)
		DELETE FROM service_event AS e
		USING ranked AS r
		WHERE e.service_event_id = r.service_event_id
			AND r.position > ${SERVICE_EVENTS_KEPT_PER_SERVICE}
		RETURNING e.service_event_id
	`)) as unknown as Iterable<{ service_event_id: string }>;

	let removed = aged.length;
	for (const _row of capped) removed += 1;
	if (removed > 0) log.info(`Pruned ${removed} service event(s)`);
	return removed;
}

/**
 * Remove one service's timeline. Called when the service is deleted — the
 * retention pass would get there eventually, but a recreated service must not
 * inherit the dead one's history through a reused id.
 */
export async function deleteServiceEvents(serviceId: string): Promise<void> {
	await db.delete(serviceEvents).where(eq(serviceEvents.serviceId, serviceId));
}

/**
 * The last events of a service, oldest first — the shape Deploy Copilot wants
 * as context ("what happened around this failure") rather than a page.
 */
export async function recentServiceEvents(
	serviceId: string,
	options: { limit?: number; before?: Date } = {},
): Promise<ServiceEventRow[]> {
	const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
	const conditions = [eq(serviceEvents.serviceId, serviceId)];
	if (options.before) conditions.push(lte(serviceEvents.occurredAt, options.before));
	const rows = await db.query.serviceEvents.findMany({
		where: and(...conditions),
		orderBy: [desc(serviceEvents.occurredAt), desc(serviceEvents.serviceEventId)],
		limit,
	});
	return rows.reverse();
}
