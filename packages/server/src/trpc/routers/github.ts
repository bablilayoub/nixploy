import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { gitProviders } from "../../db/schema";
import {
	createGithub,
	findGithubById,
	getGithubAppManifest,
	getGithubBranches,
	getGithubRepositories,
	listGithubByOrganization,
	removeGithub,
	setupGithubApp,
	syncGithubInstallation,
} from "../../modules/git";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const githubIdInput = z.object({ githubId: z.string().min(1) });

/** Public base URL of this instance (used for GitHub App manifest URLs). */
function getBaseUrl(input?: string): string {
	const baseUrl =
		input ?? process.env.NIXPLOY_BASE_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
	return baseUrl.replace(/\/$/, "");
}

/**
 * Response shape: App private key, client secret and webhook secret are
 * write-only. Clients get `*Configured` flags so the UI can show setup state.
 */
const publicGithub = <
	T extends {
		githubPrivateKey: string | null;
		githubClientSecret: string | null;
		githubWebhookSecret: string | null;
	},
>(
	row: T,
) => {
	const { githubPrivateKey, githubClientSecret, githubWebhookSecret, ...rest } = row;
	return {
		...rest,
		githubPrivateKeyConfigured: Boolean(githubPrivateKey),
		githubClientSecretConfigured: Boolean(githubClientSecret),
		githubWebhookSecretConfigured: Boolean(githubWebhookSecret),
	};
};

export const githubRouter = router({
	/** All GitHub App providers of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await listGithubByOrganization(organizationId);
		return rows.map(({ github: row, gitProvider }) => ({
			github: publicGithub(row),
			gitProvider,
		}));
	}),

	/** A single GitHub provider by id. */
	one: protectedProcedure.input(githubIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findGithubById(input.githubId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "GitHub provider not found" });
		}
		return publicGithub(row);
	}),

	/** Create an (unconfigured) GitHub provider; convert it via `createAppManifest`. */
	create: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
			const created = await createGithub(input.name, organizationId);
			if (!created.github) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create GitHub provider",
				});
			}
			return { gitProvider: created.gitProvider, github: publicGithub(created.github) };
		}),

	/** Rename the provider. */
	update: protectedProcedure
		.input(githubIdInput.extend({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
			const row = await findGithubById(input.githubId, organizationId);
			if (!row) {
				throw new TRPCError({ code: "NOT_FOUND", message: "GitHub provider not found" });
			}
			const [provider] = await db
				.update(gitProviders)
				.set({ name: input.name })
				.where(eq(gitProviders.gitProviderId, row.gitProviderId))
				.returning();
			return { gitProvider: provider, github: publicGithub(row) };
		}),

	/** Remove the provider (cascades to the github credentials row). */
	remove: protectedProcedure.input(githubIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const removed = await removeGithub(input.githubId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "GitHub provider not found" });
		}
		return publicGithub(removed);
	}),

	/** Repositories accessible to the GitHub App installation. */
	listRepositories: protectedProcedure.input(githubIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await getGithubRepositories(input.githubId, organizationId);
	}),

	/** Branches of one repository. */
	listBranches: protectedProcedure
		.input(githubIdInput.extend({ owner: z.string().min(1), repo: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			return await getGithubBranches({
				githubId: input.githubId,
				organizationId,
				owner: input.owner,
				repo: input.repo,
			});
		}),

	/**
	 * Build the GitHub App manifest flow payload. The UI auto-submits a hidden
	 * POST form to the returned `url` with `manifest` + `state`; GitHub then
	 * redirects back with a `code` for `handleCallback`.
	 */
	createAppManifest: protectedProcedure
		.input(
			githubIdInput.extend({
				baseUrl: z.string().optional(),
				appName: z.string().optional(),
				redirectPath: z.string().optional(),
				webhookPath: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
			return await getGithubAppManifest({
				githubId: input.githubId,
				organizationId,
				baseUrl: getBaseUrl(input.baseUrl),
				appName: input.appName,
				redirectPath: input.redirectPath,
				webhookPath: input.webhookPath,
			});
		}),

	/**
	 * Exchange the manifest `code` for real App credentials and discover the
	 * installation. Called by the `/api/github/callback` route handler.
	 */
	handleCallback: protectedProcedure
		.input(
			githubIdInput.extend({
				code: z.string().min(1),
				state: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
			const updated = await setupGithubApp({
				githubId: input.githubId,
				organizationId,
				code: input.code,
				state: input.state,
			});
			if (!updated) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "GitHub App setup failed" });
			}
			return publicGithub(updated);
		}),

	/** Re-fetch the App installation id (after installing on a new account). */
	syncInstallation: protectedProcedure.input(githubIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const row = await findGithubById(input.githubId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "GitHub provider not found" });
		}
		return await syncGithubInstallation(row.githubId);
	}),
});
