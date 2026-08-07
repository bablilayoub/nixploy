import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createGitlab,
	findGitlabById,
	getGitlabBranches,
	getGitlabRepositories,
	listGitlabByOrganization,
	removeGitlab,
	testGitlabConnection,
	updateGitlabById,
	updateGitlabProviderName,
} from "../../modules/git";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const gitlabIdInput = z.object({ gitlabId: z.string().min(1) });

const createGitlabInput = z.object({
	name: z.string().min(1),
	gitlabUrl: z.string().optional(),
	accessToken: z.string().min(1),
	groupName: z.string().nullish(),
	applicationId: z.string().nullish(),
	secret: z.string().nullish(),
	redirectUri: z.string().nullish(),
});

/** Response shape: PAT / OAuth secrets are write-only. */
const publicGitlab = <
	T extends {
		accessToken: string | null;
		refreshToken: string | null;
		secret: string | null;
	},
>(
	row: T,
) => {
	const { accessToken, refreshToken, secret, ...rest } = row;
	return {
		...rest,
		accessTokenConfigured: Boolean(accessToken),
		refreshTokenConfigured: Boolean(refreshToken),
		secretConfigured: Boolean(secret),
	};
};

export const gitlabRouter = router({
	/** All GitLab providers of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await listGitlabByOrganization(organizationId);
		return rows.map(({ gitlab: row, gitProvider }) => ({
			gitlab: publicGitlab(row),
			gitProvider,
		}));
	}),

	/** A single GitLab provider by id. */
	one: protectedProcedure.input(gitlabIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findGitlabById(input.gitlabId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "GitLab provider not found" });
		}
		return publicGitlab(row);
	}),

	/** Add a GitLab provider (PAT and/or OAuth app credentials). */
	create: protectedProcedure.input(createGitlabInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const created = await createGitlab(input, organizationId);
		if (!created.gitlab) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create GitLab provider",
			});
		}
		return { gitProvider: created.gitProvider, gitlab: publicGitlab(created.gitlab) };
	}),

	/** Update credentials and/or the provider name. */
	update: protectedProcedure
		.input(
			createGitlabInput.partial().extend({
				gitlabId: z.string().min(1),
				refreshToken: z.string().nullish(),
				expiresAt: z.number().int().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
			const { gitlabId, name, ...values } = input;
			if (name) {
				await updateGitlabProviderName(gitlabId, name, organizationId);
			}
			const updated = await updateGitlabById(gitlabId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "GitLab provider not found" });
			}
			return publicGitlab(updated);
		}),

	/** Remove the provider (cascades to the gitlab credentials row). */
	remove: protectedProcedure.input(gitlabIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const removed = await removeGitlab(input.gitlabId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "GitLab provider not found" });
		}
		return publicGitlab(removed);
	}),

	/** Repositories visible to the configured token (group or membership). */
	listRepositories: protectedProcedure.input(gitlabIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await getGitlabRepositories(input.gitlabId, organizationId);
	}),

	/** Branches of one project (`projectId` accepts a numeric id or `group/repo`). */
	listBranches: protectedProcedure
		.input(gitlabIdInput.extend({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			return await getGitlabBranches({
				gitlabId: input.gitlabId,
				organizationId,
				projectId: input.projectId,
			});
		}),

	/** Verify the configured token against the GitLab API. */
	testConnection: protectedProcedure.input(gitlabIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		return await testGitlabConnection(input.gitlabId, organizationId);
	}),
});
