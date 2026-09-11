import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import {
	applySuggestedEnvPatch,
	chatAboutService,
	explainAndCacheDeploymentFailure,
	generateComposeYaml,
	getAiSettings,
	isEnvLikePatch,
	patchAiSettings,
	publicAiSettings,
	readCachedExplanation,
} from "../../modules/ai";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { isDomainError } from "../../modules/errors";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function requireInstanceAdmin(session: Session): Promise<string> {
	await assertInstanceAdmin(session);
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

async function requireMember(session: Session): Promise<string> {
	const organizationId = await resolveCallerOrganizationId(
		session.user.id,
		session.session.activeOrganizationId,
	);
	await assertCapability(session.user.id, organizationId, "ai.use");
	return organizationId;
}

const providerSchema = z.enum(["openai", "anthropic", "openai-compatible", "ollama"]);

export const aiRouter = router({
	/** Public-ish status for Copilot UI (no secrets). Admins use updateSettings to change. */
	getSettings: protectedProcedure.query(async ({ ctx }) => {
		await requireMember(ctx.session);
		return publicAiSettings(await getAiSettings());
	}),

	updateSettings: protectedProcedure
		.input(
			z.object({
				enabled: z.boolean().optional(),
				provider: providerSchema.optional(),
				baseUrl: z.string().max(512).nullable().optional(),
				model: z.string().min(1).max(128).optional(),
				apiKey: z.string().max(512).nullable().optional(),
				clearApiKey: z.boolean().optional(),
				autoExplainOnFailure: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			const next = await patchAiSettings(input);
			void auditFromSession(ctx, organizationId, {
				action: "ai.settings.update",
				targetType: "web_server",
				targetId: "ai",
				targetName: "Deploy Copilot",
				metadata: {
					enabled: next.enabled,
					provider: next.provider,
					model: next.model,
				},
			});
			return publicAiSettings(next);
		}),

	explainDeployment: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
				/** Skip cached auto/manual explanation and call the model again. */
				force: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireMember(ctx.session);
			try {
				if (!input.force) {
					const deployment = await db.query.deployments.findFirst({
						where: eq(deployments.deploymentId, input.deploymentId),
						with: {
							application: { with: { environment: { with: { project: true } } } },
							compose: { with: { environment: { with: { project: true } } } },
						},
					});
					const orgId =
						deployment?.application?.environment.project.organizationId ??
						deployment?.compose?.environment.project.organizationId;
					if (deployment?.logPath && orgId === organizationId) {
						const cached = await readCachedExplanation(deployment.logPath);
						if (cached) return cached;
					}
				}
				return await explainAndCacheDeploymentFailure(input.deploymentId, organizationId);
			} catch (error) {
				// A DomainError already carries the right code (the boundary in
				// init.ts maps it); only legacy plain Errors need this guesswork.
				if (isDomainError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("not found")) {
					throw new TRPCError({ code: "NOT_FOUND", message });
				}
				throw new TRPCError({ code: "BAD_REQUEST", message });
			}
		}),

	/** Read a cached Copilot explanation without calling the model. */
	getExplanation: protectedProcedure
		.input(z.object({ deploymentId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await requireMember(ctx.session);
			const deployment = await db.query.deployments.findFirst({
				where: eq(deployments.deploymentId, input.deploymentId),
				with: {
					application: { with: { environment: { with: { project: true } } } },
					compose: { with: { environment: { with: { project: true } } } },
				},
			});
			const orgId =
				deployment?.application?.environment.project.organizationId ??
				deployment?.compose?.environment.project.organizationId;
			if (!deployment || orgId !== organizationId) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
			}
			if (!deployment.logPath) return null;
			return readCachedExplanation(deployment.logPath);
		}),

	/**
	 * Apply an env-like Copilot suggestedPatch to the service and optionally redeploy.
	 * Non-env patches are rejected — copy them manually from the Explain dialog.
	 */
	applySuggestedPatch: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
				patch: z.string().max(16_000).optional(),
				redeploy: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireMember(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "ai.use");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			if (input.redeploy !== false) {
				await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			}
			const patch = input.patch?.trim();
			if (patch && !isEnvLikePatch(patch)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Suggested patch is not env KEY=VALUE lines — copy it manually, then Redeploy",
				});
			}
			try {
				const result = await applySuggestedEnvPatch({
					deploymentId: input.deploymentId,
					organizationId,
					patch,
					redeploy: input.redeploy,
				});
				void auditFromSession(ctx, organizationId, {
					action: "ai.applySuggestedPatch",
					targetType: "deployment",
					targetId: input.deploymentId,
					metadata: {
						keys: result.appliedKeys,
						redeployed: Boolean(result.deploymentId),
					},
				});
				return result;
			} catch (error) {
				// A DomainError already carries the right code (the boundary in
				// init.ts maps it); only legacy plain Errors need this guesswork.
				if (isDomainError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("not found")) {
					throw new TRPCError({ code: "NOT_FOUND", message });
				}
				throw new TRPCError({ code: "BAD_REQUEST", message });
			}
		}),

	chat: protectedProcedure
		.input(
			z
				.object({
					applicationId: z.string().min(1).optional(),
					composeId: z.string().min(1).optional(),
					messages: z
						.array(
							z.object({
								role: z.enum(["user", "assistant"]),
								content: z.string().min(1).max(8_000),
							}),
						)
						.min(1)
						.max(20),
				})
				.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
					message: "Provide exactly one of applicationId or composeId",
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireMember(ctx.session);
			try {
				const target = input.applicationId
					? { type: "application" as const, applicationId: input.applicationId }
					: { type: "compose" as const, composeId: input.composeId as string };
				return await chatAboutService(target, organizationId, input.messages);
			} catch (error) {
				// A DomainError already carries the right code (the boundary in
				// init.ts maps it); only legacy plain Errors need this guesswork.
				if (isDomainError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("not found")) {
					throw new TRPCError({ code: "NOT_FOUND", message });
				}
				throw new TRPCError({ code: "BAD_REQUEST", message });
			}
		}),

	/** Draft a docker-compose.yml from a prompt. Does not save or deploy. */
	generateCompose: protectedProcedure
		.input(z.object({ prompt: z.string().min(8).max(4_000) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireMember(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "ai.use");
			try {
				const result = await generateComposeYaml(input.prompt);
				void auditFromSession(ctx, organizationId, {
					action: "ai.generateCompose",
					targetType: "compose",
					metadata: { model: result.model, promptChars: input.prompt.length },
				});
				return result;
			} catch (error) {
				if (isDomainError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				throw new TRPCError({ code: "BAD_REQUEST", message });
			}
		}),
});
