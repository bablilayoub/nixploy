import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	applyConfiguration,
	configurationScopeSchema,
	configurationTargetSchema,
	reviewConfiguration,
} from "../../modules/configuration-release";
import { resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

export const configurationReleaseRouter = router({
	review: protectedProcedure
		.input(z.object({ scope: configurationScopeSchema }))
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return await reviewConfiguration(input.scope, organizationId, ctx.session.user.id);
		}),
	deployReviewed: protectedProcedure
		.input(
			z.object({
				scope: configurationScopeSchema,
				reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
				targets: z.array(configurationTargetSchema).min(1).max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			const result = await applyConfiguration(input, organizationId, ctx.session.user.id);
			void auditFromSession(ctx, organizationId, {
				action: "configuration.release",
				targetType: "organization",
				targetId: organizationId,
				metadata: { releaseId: result.releaseId, services: result.deployments.length },
			});
			return result;
		}),
});
