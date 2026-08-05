import { db } from "../../db";
import { auditLogs } from "../../db/schema";

export interface AuditEntry {
	organizationId: string;
	/** Omit for system actions (crons, reconciler). */
	actorId?: string | null;
	actorEmail?: string | null;
	/** Dot-namespaced action, e.g. "project.create". */
	action: string;
	targetType?: string | null;
	targetId?: string | null;
	targetName?: string | null;
	/** Extra context; JSON-stringified. Must never contain secrets. */
	metadata?: Record<string, unknown> | null;
}

/**
 * Append an entry to the org's audit trail. Fire-and-forget: audit failures
 * are logged but never break the mutation they describe.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
	try {
		await db.insert(auditLogs).values({
			organizationId: entry.organizationId,
			actorId: entry.actorId ?? null,
			actorEmail: entry.actorEmail ?? null,
			action: entry.action,
			targetType: entry.targetType ?? null,
			targetId: entry.targetId ?? null,
			targetName: entry.targetName ?? null,
			metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
		});
	} catch (error) {
		console.error(`Audit write failed (${entry.action}):`, error);
	}
}

/** Convenience for tRPC mutations: actor pulled from the session context. */
export function auditFromSession(
	ctx: { session: { user: { id: string; email?: string | null } } },
	organizationId: string,
	entry: Omit<AuditEntry, "organizationId" | "actorId" | "actorEmail">,
): Promise<void> {
	return recordAudit({
		organizationId,
		actorId: ctx.session.user.id,
		actorEmail: ctx.session.user.email ?? null,
		...entry,
	});
}
