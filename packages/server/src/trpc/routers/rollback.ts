import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { rollbacks } from "../../db/schema";
import { assertApplicationAccess, getOrganizationId } from "../../modules/application";
import { assertCapability } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/** Load an application-owned rollback row and verify org ownership. */
const findApplicationRollback = async (rollbackId: string, organizationId: string) => {
	const rollback = await db.query.rollbacks.findFirst({
		where: eq(rollbacks.rollbackId, rollbackId),
	});
	if (!rollback) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Rollback not found" });
	}
	const application = await assertApplicationAccess(rollback.applicationId, organizationId);
	return { rollback, application };
};

export const rollbackRouter = router({
	/** All pinned rollback images of an application (newest first). */
	all: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);
			return db.query.rollbacks.findMany({
				where: eq(rollbacks.applicationId, input.applicationId),
				orderBy: desc(rollbacks.createdAt),
				with: { deployment: true },
			});
		}),

	one: protectedProcedure
		.input(z.object({ rollbackId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { rollback } = await findApplicationRollback(input.rollbackId, organizationId);
			return rollback;
		}),

	delete: protectedProcedure
		.input(z.object({ rollbackId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const { rollback } = await findApplicationRollback(input.rollbackId, organizationId);
			await db.delete(rollbacks).where(eq(rollbacks.rollbackId, rollback.rollbackId));
			return { rollbackId: rollback.rollbackId };
		}),
});
