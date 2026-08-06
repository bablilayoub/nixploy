import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { members } from "../../db/schema";
import {
	chatAboutApplication,
	explainDeploymentFailure,
	getAiSettings,
	patchAiSettings,
	publicAiSettings,
} from "../../modules/ai";
import { auditFromSession } from "../../modules/audit";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function requireOwnerOrAdmin(session: Session): Promise<string> {
	const organizationId = await resolveCallerOrganizationId(
		session.user.id,
		session.session.activeOrganizationId,
	);
	const membership = await db.query.members.findFirst({
		where: and(eq(members.organizationId, organizationId), eq(members.userId, session.user.id)),
	});
	const roles = (membership?.role ?? "").split(",").map((role) => role.trim());
	if (!roles.includes("owner") && !roles.includes("admin")) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "AI Copilot settings require an owner or admin role",
		});
	}
	return organizationId;
}

async function requireMember(session: Session): Promise<string> {
	const organizationId = await resolveCallerOrganizationId(
		session.user.id,
		session.session.activeOrganizationId,
	);
	await assertOrgRole(session.user.id, organizationId, "member");
	return organizationId;
}

const providerSchema = z.enum(["openai", "anthropic", "openai-compatible", "ollama"]);

export const aiRouter = router({
	getSettings: protectedProcedure.query(async ({ ctx }) => {
		await requireOwnerOrAdmin(ctx.session);
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
			const organizationId = await requireOwnerOrAdmin(ctx.session);
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
		.input(z.object({ deploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireMember(ctx.session);
			try {
				return await explainDeploymentFailure(input.deploymentId, organizationId);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("not found")) {
					throw new TRPCError({ code: "NOT_FOUND", message });
				}
				throw new TRPCError({ code: "BAD_REQUEST", message });
			}
		}),

	chat: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().min(1),
				messages: z
					.array(
						z.object({
							role: z.enum(["user", "assistant"]),
							content: z.string().min(1).max(8_000),
						}),
					)
					.min(1)
					.max(20),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireMember(ctx.session);
			try {
				return await chatAboutApplication(input.applicationId, organizationId, input.messages);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("not found")) {
					throw new TRPCError({ code: "NOT_FOUND", message });
				}
				throw new TRPCError({ code: "BAD_REQUEST", message });
			}
		}),
});
