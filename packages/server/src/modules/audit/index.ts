import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLogs, organizations } from "../../db/schema";
import { clientIpFromHeaders, userAgentFromHeaders } from "../../utils/rate-limit";
import { createTtlCache } from "../../utils/ttl-cache";

export interface AuditEntry {
	/** Null for instance-level events (auth by a user who belongs to no org). */
	organizationId?: string | null;
	/**
	 * Denormalised org name. Resolved automatically when omitted; it is what
	 * keeps a trail readable after the organization is deleted (the FK is
	 * `on delete set null`, security audit 2.9).
	 */
	organizationName?: string | null;
	/** Omit for system actions (crons, reconciler). */
	actorId?: string | null;
	actorEmail?: string | null;
	/** Dot-namespaced action, e.g. "project.create". */
	action: string;
	targetType?: string | null;
	targetId?: string | null;
	targetName?: string | null;
	/** Client IP as resolved by the trusted-proxy policy. */
	ip?: string | null;
	/** Raw `User-Agent` of the request. */
	userAgent?: string | null;
	/** Extra context; JSON-stringified. Must never contain secrets. */
	metadata?: Record<string, unknown> | null;
}

/** Org names change rarely; one lookup per audit write would be wasteful. */
const orgNameCache = createTtlCache<string | null>({ ttlMs: 5 * 60_000 });

async function organizationNameFor(organizationId: string): Promise<string | null> {
	try {
		return await orgNameCache.get(organizationId, async () => {
			const row = await db.query.organizations.findFirst({
				where: eq(organizations.id, organizationId),
				columns: { name: true },
			});
			return row?.name ?? null;
		});
	} catch {
		return null;
	}
}

/**
 * Append an entry to the audit trail. Fire-and-forget: audit failures are
 * logged but never break the mutation they describe.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
	try {
		const organizationId = entry.organizationId ?? null;
		const organizationName =
			entry.organizationName ?? (organizationId ? await organizationNameFor(organizationId) : null);
		await db.insert(auditLogs).values({
			organizationId,
			organizationName,
			actorId: entry.actorId ?? null,
			actorEmail: entry.actorEmail ?? null,
			action: entry.action,
			targetType: entry.targetType ?? null,
			targetId: entry.targetId ?? null,
			targetName: entry.targetName ?? null,
			ip: entry.ip ?? null,
			userAgent: entry.userAgent ?? null,
			metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
		});
		queueForwardedAudit(entry);
	} catch (error) {
		console.error(`Audit write failed (${entry.action}):`, error);
	}
}

/** Minimal shape of a tRPC context an audit call needs. */
interface AuditContext {
	session: { user: { id: string; email?: string | null } };
	/** Request headers — present on every tRPC/REST/MCP context. */
	headers?: Headers | null;
}

/**
 * Convenience for tRPC mutations: actor from the session, client IP and user
 * agent from the request headers (the IP honours `TRUSTED_PROXIES` and the
 * socket-peer check, so it is never a forged `X-Forwarded-For`).
 */
export function auditFromSession(
	ctx: AuditContext,
	organizationId: string,
	entry: Omit<AuditEntry, "organizationId" | "actorId" | "actorEmail" | "ip" | "userAgent">,
): Promise<void> {
	const headers = ctx.headers ?? null;
	return recordAudit({
		organizationId,
		actorId: ctx.session.user.id,
		actorEmail: ctx.session.user.email ?? null,
		ip: headers ? clientIpFromHeaders(headers) : null,
		userAgent: userAgentFromHeaders(headers),
		...entry,
	});
}

// ── CSV export ──────────────────────────────────────────────────────────────

export const AUDIT_CSV_COLUMNS = [
	"createdAt",
	"organizationId",
	"organizationName",
	"actorId",
	"actorEmail",
	"action",
	"targetType",
	"targetId",
	"targetName",
	"ip",
	"userAgent",
	"metadata",
] as const;

type AuditCsvRow = Partial<Record<(typeof AUDIT_CSV_COLUMNS)[number], unknown>>;

/**
 * RFC 4180 quoting, plus a leading `'` on anything a spreadsheet would treat
 * as a formula — audit rows carry tenant-controlled names.
 */
function csvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	const text = value instanceof Date ? value.toISOString() : String(value);
	const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
	return `"${guarded.replace(/"/g, '""')}"`;
}

/** Render audit rows as CSV (header + one line per row). */
export function auditRowsToCsv(rows: readonly AuditCsvRow[]): string {
	const lines = [AUDIT_CSV_COLUMNS.join(",")];
	for (const row of rows) {
		lines.push(AUDIT_CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
	}
	return `${lines.join("\n")}\n`;
}

// ── optional forwarding ─────────────────────────────────────────────────────
//
// A compromised instance admin can delete the audit table. `NIXPLOY_AUDIT_
// FORWARD=1` mirrors every row to the instance-admin notification channels
// (security audit 2.9) so the trail also lives somewhere the panel cannot
// reach. Batched once a minute: one message per row would flood a webhook.

export const AUDIT_FORWARD_INTERVAL_MS = 60_000;
/** Cap on rows kept per batch — the summary names the overflow. */
export const AUDIT_FORWARD_MAX_ROWS = 50;

let forwardBuffer: AuditEntry[] = [];
let forwardDropped = 0;
let forwardTimer: NodeJS.Timeout | null = null;

/** Whether audit forwarding is enabled (`NIXPLOY_AUDIT_FORWARD=1`). */
export const auditForwardingEnabled = (): boolean => process.env.NIXPLOY_AUDIT_FORWARD === "1";

/** One line per row: who did what to which target. Never carries metadata. */
export function formatForwardedAudit(entries: readonly AuditEntry[], dropped = 0): string {
	const lines = entries.map((entry) => {
		const actor = entry.actorEmail ?? entry.actorId ?? "system";
		const target = entry.targetName ?? entry.targetId ?? "";
		const from = entry.ip && entry.ip !== "unknown" ? ` from ${entry.ip}` : "";
		return `${actor} ${entry.action}${target ? ` ${target}` : ""}${from}`;
	});
	if (dropped > 0) lines.push(`…and ${dropped} more`);
	return lines.join("\n");
}

function queueForwardedAudit(entry: AuditEntry): void {
	if (!auditForwardingEnabled()) return;
	if (forwardBuffer.length >= AUDIT_FORWARD_MAX_ROWS) forwardDropped += 1;
	else forwardBuffer.push(entry);
	if (forwardTimer) return;
	forwardTimer = setTimeout(() => {
		forwardTimer = null;
		void flushForwardedAudit();
	}, AUDIT_FORWARD_INTERVAL_MS);
	forwardTimer.unref?.();
}

/** Send the buffered batch. Exported for tests and for shutdown. */
export async function flushForwardedAudit(): Promise<number> {
	const batch = forwardBuffer;
	const dropped = forwardDropped;
	forwardBuffer = [];
	forwardDropped = 0;
	if (batch.length === 0) return 0;
	try {
		const { emitPlatformAlert } = await import("../notifications/platform");
		await emitPlatformAlert({
			kind: "auditForward",
			severity: "warning",
			summary: formatForwardedAudit(batch, dropped),
			fields: [{ name: "Events", value: String(batch.length + dropped) }],
		});
	} catch (error) {
		console.error("Audit forwarding failed:", error);
	}
	return batch.length;
}
