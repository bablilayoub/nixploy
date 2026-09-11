import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	createGitea,
	findGiteaById,
	getGiteaBranches,
	getGiteaRepositories,
	listGiteaByOrganization,
	removeGitea,
	testGiteaConnection,
	updateGiteaById,
	updateGiteaProviderName,
} from "../../modules/git";
import { derivedWebhookSecret } from "../../modules/git/webhook-secret";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { assertSafeOutboundUrl } from "../../utils/public-url";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function assertSafeGitHostUrl(url: string, label: string): Promise<void> {
	try {
		await assertSafeOutboundUrl(url, { allowPrivate: true, allowHttp: true });
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: error instanceof Error ? `${label}: ${error.message}` : `Invalid ${label}`,
		});
	}
}

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const giteaIdInput = z.object({ giteaId: z.string().min(1) });

const createGiteaInput = z.object({
	name: z.string().min(1),
	giteaUrl: z.string().optional(),
	accessToken: z.string().min(1),
	redirectUri: z.string().nullish(),
});

/** Response shape: access / refresh tokens and webhook secret are write-only. */
const publicGitea = <
	T extends {
		giteaId: string;
		accessToken: string | null;
		refreshToken: string | null;
	},
>(
	row: T,
) => {
	const { accessToken, refreshToken, ...rest } = row;
	return {
		...rest,
		accessTokenConfigured: Boolean(accessToken),
		refreshTokenConfigured: Boolean(refreshToken),
		webhookSecretConfigured: true,
	};
};

export const giteaRouter = router({
	/** All Gitea providers of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await listGiteaByOrganization(organizationId);
		return rows.map(({ gitea: row, gitProvider }) => ({
			gitea: publicGitea(row),
			gitProvider,
		}));
	}),

	/** A single Gitea provider by id. */
	one: protectedProcedure.input(giteaIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findGiteaById(input.giteaId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Gitea provider not found" });
		}
		return publicGitea(row);
	}),

	/** Add a Gitea provider (access token). */
	create: protectedProcedure.input(createGiteaInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		if (input.giteaUrl) {
			await assertSafeGitHostUrl(input.giteaUrl, "Gitea URL");
		}
		const created = await createGitea(input, organizationId);
		if (!created.gitea) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create Gitea provider",
			});
		}
		void auditFromSession(ctx, organizationId, {
			action: "gitea.create",
			targetType: "gitProvider",
			targetId: created.gitea.giteaId,
			targetName: created.gitProvider.name,
		});
		return { gitProvider: created.gitProvider, gitea: publicGitea(created.gitea) };
	}),

	/** Update credentials and/or the provider name. */
	update: protectedProcedure
		.input(
			createGiteaInput.partial().extend({
				giteaId: z.string().min(1),
				refreshToken: z.string().nullish(),
				expiresAt: z.number().int().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
			const { giteaId, name, ...values } = input;
			if (values.giteaUrl) {
				await assertSafeGitHostUrl(values.giteaUrl, "Gitea URL");
			}
			if (name) {
				await updateGiteaProviderName(giteaId, name, organizationId);
			}
			const updated = await updateGiteaById(giteaId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Gitea provider not found" });
			}
			void auditFromSession(ctx, organizationId, {
				action: "gitea.update",
				targetType: "gitProvider",
				targetId: giteaId,
				targetName: name ?? null,
				metadata: {
					credentialsChanged: values.accessToken !== undefined || values.refreshToken !== undefined,
					urlChanged: values.giteaUrl !== undefined,
				},
			});
			return publicGitea(updated);
		}),

	/** Remove the provider (cascades to the gitea credentials row). */
	remove: protectedProcedure.input(giteaIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const removed = await removeGitea(input.giteaId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Gitea provider not found" });
		}
		void auditFromSession(ctx, organizationId, {
			action: "gitea.delete",
			targetType: "gitProvider",
			targetId: input.giteaId,
		});
		return publicGitea(removed);
	}),

	/** Repositories visible to the configured token. */
	listRepositories: protectedProcedure.input(giteaIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.create");
		return await getGiteaRepositories(input.giteaId, organizationId);
	}),

	/** Branches of one repository. */
	listBranches: protectedProcedure
		.input(giteaIdInput.extend({ owner: z.string().min(1), repo: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.create");
			return await getGiteaBranches({
				giteaId: input.giteaId,
				organizationId,
				owner: input.owner,
				repo: input.repo,
			});
		}),

	/** Verify the configured token against the Gitea API. */
	testConnection: protectedProcedure.input(giteaIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		void auditFromSession(ctx, organizationId, {
			action: "gitea.testConnection",
			targetType: "gitProvider",
			targetId: input.giteaId,
		});
		return await testGiteaConnection(input.giteaId, organizationId);
	}),

	/**
	 * Reveal the derived HMAC webhook secret for webhook setup.
	 * Gated — viewers must not forge signed Gitea deliveries.
	 */
	revealWebhookSecret: protectedProcedure.input(giteaIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const row = await findGiteaById(input.giteaId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Gitea provider not found" });
		}
		return { webhookSecret: derivedWebhookSecret("gitea", row.giteaId) };
	}),
});
