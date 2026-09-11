import { and, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs } from "../../db/schema";
import { auditRowsToCsv } from "../../modules/audit";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/**
 * Time window bound. An ISO timestamp, or a relative `30m` / `24h` / `7d`
 * offset from now — the CLI (`nixploy audit list --since 24h`) and the REST
 * adapter both send plain strings, so the coercion lives here rather than in
 * every caller. `z.coerce.date()` alone would accept `"7d"` as an invalid date.
 */
const RELATIVE_WINDOW = /^(\d{1,6})([mhd])$/;
const RELATIVE_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseAuditWindow(value: string, now = new Date()): Date | null {
	const trimmed = value.trim();
	const relative = RELATIVE_WINDOW.exec(trimmed);
	if (relative?.[1] && relative[2]) {
		const ms = RELATIVE_MS[relative[2]];
		if (!ms) return null;
		return new Date(now.getTime() - Number(relative[1]) * ms);
	}
	const parsed = new Date(trimmed);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// A string, not `z.date()`: the REST adapter introspects this schema to decide
// which flattened query params to coerce, and a date is not representable in
// JSON Schema — one here would disable coercion for `limit`/`offset` too.
const windowSchema = z
	.string()
	.min(1)
	.max(64)
	.transform((value, ctx) => {
		const parsed = parseAuditWindow(value);
		if (!parsed) {
			ctx.addIssue({
				code: "custom",
				message: `Expected an ISO date or a window like 30m, 24h, 7d (got "${value}")`,
			});
			return z.NEVER;
		}
		return parsed;
	})
	.optional();

/** Org audit trail, newest first, with optional filters. */
export const auditRouter = router({
	all: protectedProcedure
		.input(
			z.object({
				action: z.string().optional(),
				targetType: z.string().optional(),
				search: z.string().max(100).optional(),
				/** Only events at or after this instant (ISO, or `30m`/`24h`/`7d`). */
				since: windowSchema,
				/** Only events strictly before this instant (same formats). */
				until: windowSchema,
				limit: z.number().int().min(1).max(200).default(50),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "audit.read");
			const conditions = [eq(auditLogs.organizationId, organizationId)];
			if (input.action) conditions.push(eq(auditLogs.action, input.action));
			if (input.targetType) conditions.push(eq(auditLogs.targetType, input.targetType));
			if (input.search) {
				conditions.push(ilike(auditLogs.targetName, `%${input.search}%`));
			}
			if (input.since) conditions.push(gte(auditLogs.createdAt, input.since));
			if (input.until) conditions.push(lt(auditLogs.createdAt, input.until));
			const [rows, total] = await Promise.all([
				db.query.auditLogs.findMany({
					where: and(...conditions),
					orderBy: desc(auditLogs.createdAt),
					limit: input.limit,
					offset: input.offset,
				}),
				db
					.select({ value: sql<number>`count(*)::int` })
					.from(auditLogs)
					.where(and(...conditions)),
			]);
			return { rows, total: total[0]?.value ?? 0 };
		}),

	/**
	 * Whole trail as CSV, for an auditor or an offline archive. Same
	 * `audit.read` gate and the same org scope as `all`; capped so one call
	 * cannot pull an unbounded result into memory.
	 */
	export: protectedProcedure
		.input(
			z.object({
				action: z.string().optional(),
				targetType: z.string().optional(),
				// Same filters as `all`, so the CSV matches what the operator is
				// looking at when they press Export.
				search: z.string().max(100).optional(),
				since: windowSchema,
				until: windowSchema,
				limit: z.number().int().min(1).max(10_000).default(5_000),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "audit.read");
			const conditions = [eq(auditLogs.organizationId, organizationId)];
			if (input.action) conditions.push(eq(auditLogs.action, input.action));
			if (input.targetType) conditions.push(eq(auditLogs.targetType, input.targetType));
			if (input.search) conditions.push(ilike(auditLogs.targetName, `%${input.search}%`));
			if (input.since) conditions.push(gte(auditLogs.createdAt, input.since));
			if (input.until) conditions.push(lt(auditLogs.createdAt, input.until));
			const rows = await db.query.auditLogs.findMany({
				where: and(...conditions),
				orderBy: desc(auditLogs.createdAt),
				limit: input.limit,
			});
			return {
				filename: `nixploy-audit-${new Date().toISOString().slice(0, 10)}.csv`,
				rows: rows.length,
				csv: auditRowsToCsv(rows),
			};
		}),

	/** Distinct actions + target types present in the org's trail (filter dropdowns). */
	facets: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "audit.read");
		const [actions, targetTypes] = await Promise.all([
			db
				.selectDistinct({ action: auditLogs.action })
				.from(auditLogs)
				.where(eq(auditLogs.organizationId, organizationId)),
			db
				.selectDistinct({ targetType: auditLogs.targetType })
				.from(auditLogs)
				.where(eq(auditLogs.organizationId, organizationId)),
		]);
		return {
			actions: actions.map((row) => row.action).sort(),
			targetTypes: targetTypes
				.map((row) => row.targetType)
				.filter((value): value is string => Boolean(value))
				.sort(),
		};
	}),
});
