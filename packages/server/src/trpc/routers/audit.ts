import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { auditLogs } from "../../db/schema";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/** Org audit trail, newest first, with optional filters. */
export const auditRouter = router({
	all: protectedProcedure
		.input(
			z.object({
				action: z.string().optional(),
				targetType: z.string().optional(),
				search: z.string().max(100).optional(),
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
