import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resolveCallerOrganizationId } from "../../modules/projects";
import {
	deployTemplate,
	findTemplateById,
	listTemplateSummaries,
	summarizeTemplateServices,
} from "../../modules/templates";
import { protectedProcedure, router } from "../init";

export const templateRouter = router({
	/** Template catalog without compose bodies (for the gallery grid). */
	all: protectedProcedure.query(() => listTemplateSummaries()),

	/** A single template including its compose body, env schema and services. */
	one: protectedProcedure.input(z.object({ templateId: z.string().min(1) })).query(({ input }) => {
		const template = findTemplateById(input.templateId);
		if (!template) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
		}
		return {
			...template,
			services: summarizeTemplateServices(template.compose, template.suggestedDomain.serviceName),
		};
	}),

	/**
	 * Instantiate a template into a project environment: creates a raw compose
	 * service (compose file + resolved `.env`), optionally attaches domains and
	 * enqueues the first deployment.
	 */
	deploy: protectedProcedure
		.input(
			z.object({
				templateId: z.string().min(1),
				projectId: z.string().min(1),
				environmentName: z.string().min(1),
				envValues: z.record(z.string(), z.string()).optional(),
				domains: z
					.array(
						z.object({
							host: z.string().min(1).max(255),
							serviceName: z.string().min(1),
							port: z.number().int().min(1).max(65535),
						}),
					)
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return await deployTemplate(organizationId, input);
		}),
});
