import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	assertCapability,
	findEnvironmentById,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import {
	assertUpstreamAccess,
	createExternalUpstream,
	deleteExternalUpstream,
	listUpstreamsByEnvironment,
	MAX_TARGET_URL_LENGTH,
	syncUpstreamTraefik,
	updateExternalUpstream,
} from "../../modules/upstreams";
import { protectedProcedure, router } from "../init";

const upstreamIdInput = z.object({ externalUpstreamId: z.string().min(1) });

const targetUrlSchema = z.string().trim().min(1).max(MAX_TARGET_URL_LENGTH);

/**
 * External upstreams: origins outside the Swarm that Traefik fronts with the
 * same domains, certificates, middlewares and uptime probes a service gets.
 * Routing configuration, so `domains.manage` gates every write.
 */
export const upstreamRouter = router({
	/** Upstreams of one environment, oldest first. */
	all: protectedProcedure
		.input(z.object({ environmentId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await findEnvironmentById(input.environmentId, organizationId);
			return listUpstreamsByEnvironment(input.environmentId);
		}),

	/** One upstream with its environment and project names (for the page header). */
	one: protectedProcedure.input(upstreamIdInput).query(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const row = await assertUpstreamAccess(input.externalUpstreamId, organizationId);
		const { environment, ...upstream } = row;
		return {
			...upstream,
			environment: {
				environmentId: environment.environmentId,
				name: environment.name,
				project: { projectId: environment.project.projectId, name: environment.project.name },
			},
		};
	}),

	create: protectedProcedure
		.input(
			z.object({
				environmentId: z.string().min(1),
				name: z.string().trim().min(1).max(255),
				description: z.string().max(2000).nullish(),
				targetUrl: targetUrlSchema,
				passHostHeader: z.boolean().optional(),
				insecureSkipVerify: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
			const environment = await findEnvironmentById(input.environmentId, organizationId);
			const row = await createExternalUpstream({
				environmentId: environment.environmentId,
				name: input.name,
				description: input.description ?? null,
				targetUrl: input.targetUrl,
				passHostHeader: input.passHostHeader,
				insecureSkipVerify: input.insecureSkipVerify,
			});
			void auditFromSession(ctx, organizationId, {
				action: "upstream.create",
				targetType: "externalUpstream",
				targetId: row.externalUpstreamId,
				targetName: row.name,
				metadata: { targetUrl: row.targetUrl, environmentId: environment.environmentId },
			});
			return row;
		}),

	update: protectedProcedure
		.input(
			upstreamIdInput.extend({
				name: z.string().trim().min(1).max(255).optional(),
				description: z.string().max(2000).nullish(),
				targetUrl: targetUrlSchema.optional(),
				passHostHeader: z.boolean().optional(),
				insecureSkipVerify: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
			const { environment: _environment, ...current } = await assertUpstreamAccess(
				input.externalUpstreamId,
				organizationId,
			);
			const row = await updateExternalUpstream(current, {
				name: input.name,
				description: input.description,
				targetUrl: input.targetUrl,
				passHostHeader: input.passHostHeader,
				insecureSkipVerify: input.insecureSkipVerify,
			});
			void auditFromSession(ctx, organizationId, {
				action: "upstream.update",
				targetType: "externalUpstream",
				targetId: row.externalUpstreamId,
				targetName: row.name,
				metadata: { targetUrl: row.targetUrl },
			});
			return row;
		}),

	/** Re-run the target policy now and rewrite the route (clears a hold that no longer applies). */
	resync: protectedProcedure.input(upstreamIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
		const { environment: _environment, ...current } = await assertUpstreamAccess(
			input.externalUpstreamId,
			organizationId,
		);
		// Re-saving the same target re-vets it and lifts the hold on success.
		const row = await updateExternalUpstream(current, { targetUrl: current.targetUrl });
		await syncUpstreamTraefik(row);
		return row;
	}),

	delete: protectedProcedure.input(upstreamIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
		const { environment: _environment, ...current } = await assertUpstreamAccess(
			input.externalUpstreamId,
			organizationId,
		);
		await deleteExternalUpstream(current);
		void auditFromSession(ctx, organizationId, {
			action: "upstream.delete",
			targetType: "externalUpstream",
			targetId: current.externalUpstreamId,
			targetName: current.name,
		});
		return { externalUpstreamId: current.externalUpstreamId };
	}),
});
