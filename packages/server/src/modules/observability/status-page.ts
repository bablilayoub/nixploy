import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { incidents, statusPages, uptimeProbes } from "../../db/schema";
import { notFound } from "../errors";

/**
 * Public status page (product audit, Observability #4).
 *
 * One row per organization, addressed by an unguessable token at
 * `/status/<token>`. Only the probes the operator explicitly published are
 * exposed, and only these fields: the probe's host, its current state, a
 * 90-day uptime percentage and the titles of recent uptime incidents. No
 * service ids, project names, URLs with paths, error strings or acknowledger
 * identities ever cross that boundary.
 */

/** Window the published uptime percentage is computed over. */
export const STATUS_PAGE_UPTIME_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Titles shown under "recent incidents". */
const PUBLIC_INCIDENT_LIMIT = 10;

/** 32 url-safe characters — guessing one is not a realistic attack. */
export const generateStatusPageToken = (): string => randomBytes(24).toString("base64url");

export type StatusPageRow = typeof statusPages.$inferSelect;

export async function getStatusPage(organizationId: string): Promise<StatusPageRow | null> {
	const row = await db.query.statusPages.findFirst({
		where: eq(statusPages.organizationId, organizationId),
	});
	return row ?? null;
}

/**
 * Create or update the org's status page. `probeIds` is the full published
 * set (an empty array publishes nothing); the token is minted once and
 * survives later edits so a shared URL keeps working.
 */
export async function enableStatusPage(input: {
	organizationId: string;
	probeIds: string[];
	title?: string;
}): Promise<StatusPageRow> {
	// Never publish a probe from another organization, whatever the caller sent.
	const owned =
		input.probeIds.length > 0
			? await db.query.uptimeProbes.findMany({
					where: and(
						eq(uptimeProbes.organizationId, input.organizationId),
						inArray(uptimeProbes.uptimeProbeId, input.probeIds),
					),
					columns: { uptimeProbeId: true },
				})
			: [];
	const ownedIds = new Set(owned.map((probe) => probe.uptimeProbeId));
	const probeIds = input.probeIds.filter((id) => ownedIds.has(id));

	const existing = await getStatusPage(input.organizationId);
	if (existing) {
		const [row] = await db
			.update(statusPages)
			.set({
				probeIds,
				enabled: true,
				...(input.title !== undefined ? { title: input.title } : {}),
			})
			.where(eq(statusPages.statusPageId, existing.statusPageId))
			.returning();
		if (!row) throw new Error("Failed to update the status page");
		return row;
	}
	const [row] = await db
		.insert(statusPages)
		.values({
			organizationId: input.organizationId,
			token: generateStatusPageToken(),
			title: input.title ?? "Status",
			probeIds,
		})
		.returning();
	if (!row) throw new Error("Failed to create the status page");
	return row;
}

/** Take the page offline without losing its token (re-enabling keeps the URL). */
export async function disableStatusPage(organizationId: string): Promise<StatusPageRow> {
	const existing = await getStatusPage(organizationId);
	if (!existing) throw notFound("No status page configured");
	const [row] = await db
		.update(statusPages)
		.set({ enabled: false })
		.where(eq(statusPages.statusPageId, existing.statusPageId))
		.returning();
	if (!row) throw new Error("Failed to disable the status page");
	return row;
}

/** Mint a fresh token, invalidating every URL shared so far. */
export async function rotateStatusPageToken(organizationId: string): Promise<StatusPageRow> {
	const existing = await getStatusPage(organizationId);
	if (!existing) throw notFound("No status page configured");
	const [row] = await db
		.update(statusPages)
		.set({ token: generateStatusPageToken() })
		.where(eq(statusPages.statusPageId, existing.statusPageId))
		.returning();
	if (!row) throw new Error("Failed to rotate the status page token");
	return row;
}

/* -------------------------------------------------------------------------- */
/*  Uptime percentage                                                         */
/* -------------------------------------------------------------------------- */

export interface UptimeEvent {
	at: Date;
	/** State the probe flipped TO. */
	status: "up" | "down";
}

/**
 * Uptime percentage over `[windowStart, now]` derived from the probe's flip
 * incidents — the only history Nixploy keeps (there is no per-check sample
 * table; `uptime_probe` holds the current state only).
 *
 * The state before the first event is the inverse of that event: a window
 * whose first flip is "up" was down until then, one whose first flip is
 * "down" was up. With no events at all the probe never flipped inside the
 * window, so its current state held the whole time.
 */
export function uptimePercentFromEvents(
	events: UptimeEvent[],
	windowStart: Date,
	now: Date,
	currentStatus: "up" | "down" | "unknown" = "up",
): number {
	const start = windowStart.getTime();
	const end = now.getTime();
	const total = end - start;
	if (total <= 0) return 100;

	const sorted = [...events]
		.filter((event) => event.at.getTime() >= start && event.at.getTime() <= end)
		.sort((a, b) => a.at.getTime() - b.at.getTime());

	if (sorted.length === 0) {
		return currentStatus === "down" ? 0 : 100;
	}

	const first = sorted[0] as UptimeEvent;
	let state: "up" | "down" = first.status === "up" ? "down" : "up";
	let cursor = start;
	let downMs = 0;
	for (const event of sorted) {
		const at = event.at.getTime();
		if (state === "down") downMs += at - cursor;
		cursor = at;
		state = event.status;
	}
	if (state === "down") downMs += end - cursor;

	const percent = ((total - downMs) / total) * 100;
	return Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
}

/* -------------------------------------------------------------------------- */
/*  Public view                                                               */
/* -------------------------------------------------------------------------- */

export interface PublicStatusProbe {
	/** Probe host — the only identifier a visitor sees. */
	name: string;
	status: "up" | "down" | "unknown";
	lastCheckedAt: Date | null;
	/** Percentage over the last {@link STATUS_PAGE_UPTIME_DAYS} days. */
	uptimePercent: number;
}

export interface PublicStatusIncident {
	title: string;
	createdAt: Date;
	resolvedAt: Date | null;
	severity: string;
}

export interface PublicStatus {
	title: string;
	generatedAt: Date;
	uptimeDays: number;
	probes: PublicStatusProbe[];
	incidents: PublicStatusIncident[];
}

/**
 * Everything `/status/<token>` renders, or null when the token is unknown or
 * the page was disabled. Deliberately the only function that reads a status
 * page by token: nothing else may turn a public token into org data.
 */
export async function loadPublicStatus(token: string): Promise<PublicStatus | null> {
	if (!token || token.length > 128) return null;
	const page = await db.query.statusPages.findFirst({ where: eq(statusPages.token, token) });
	if (!page?.enabled) return null;

	const probeIds = Array.isArray(page.probeIds) ? page.probeIds : [];
	const now = new Date();
	const windowStart = new Date(now.getTime() - STATUS_PAGE_UPTIME_DAYS * DAY_MS);

	const rows =
		probeIds.length > 0
			? await db.query.uptimeProbes.findMany({
					where: and(
						eq(uptimeProbes.organizationId, page.organizationId),
						inArray(uptimeProbes.uptimeProbeId, probeIds),
					),
					with: { domain: { columns: { host: true } } },
				})
			: [];

	// One query for the window's uptime incidents; they carry both the flip
	// history (for the percentage) and the public titles.
	const uptimeIncidents =
		rows.length > 0
			? await db.query.incidents.findMany({
					where: and(
						eq(incidents.organizationId, page.organizationId),
						eq(incidents.kind, "uptime"),
						gte(incidents.createdAt, windowStart),
					),
					orderBy: [desc(incidents.createdAt)],
					limit: 500,
				})
			: [];

	const byHost = new Map<string, UptimeEvent[]>();
	for (const incident of uptimeIncidents) {
		const host = incident.serviceName;
		if (!host) continue;
		const status = (incident.metadata as { status?: unknown } | null)?.status;
		if (status !== "up" && status !== "down") continue;
		byHost.set(host, [...(byHost.get(host) ?? []), { at: incident.createdAt, status }]);
	}

	// Preserve the operator's ordering from `probeIds`.
	const order = new Map(probeIds.map((id, index) => [id, index] as const));
	const probes: PublicStatusProbe[] = rows
		.sort((a, b) => (order.get(a.uptimeProbeId) ?? 0) - (order.get(b.uptimeProbeId) ?? 0))
		.map((probe): PublicStatusProbe => {
			const host = probe.domain?.host ?? "";
			const status: PublicStatusProbe["status"] =
				probe.status === "up" || probe.status === "down" ? probe.status : "unknown";
			return {
				name: host,
				status,
				lastCheckedAt: probe.lastCheckedAt,
				uptimePercent: uptimePercentFromEvents(
					byHost.get(host) ?? [],
					// A probe younger than the window was not down before it existed.
					probe.createdAt > windowStart ? probe.createdAt : windowStart,
					now,
					status,
				),
			};
		})
		.filter((probe) => probe.name.length > 0);

	const publishedHosts = new Set(probes.map((probe) => probe.name));
	const publicIncidents: PublicStatusIncident[] = uptimeIncidents
		.filter((incident) => incident.serviceName && publishedHosts.has(incident.serviceName))
		.slice(0, PUBLIC_INCIDENT_LIMIT)
		.map((incident) => ({
			// Titles are generated by `runOneProbe` ("Uptime down: <host>") and
			// never contain the probe's error text.
			title: incident.title,
			createdAt: incident.createdAt,
			resolvedAt: incident.resolvedAt,
			severity: incident.severity,
		}));

	return {
		title: page.title,
		generatedAt: now,
		uptimeDays: STATUS_PAGE_UPTIME_DAYS,
		probes,
		incidents: publicIncidents,
	};
}
