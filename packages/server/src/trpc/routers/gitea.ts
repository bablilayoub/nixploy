import { TRPCError } from "@trpc/server";
import { z } from "zod";
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
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

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

/** Response shape: access / refresh tokens are write-only. */
const publicGitea = <
	T extends {
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
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		return await createGitea(input, organizationId);
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
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			const { giteaId, name, ...values } = input;
			if (name) {
				await updateGiteaProviderName(giteaId, name, organizationId);
			}
			const updated = await updateGiteaById(giteaId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Gitea provider not found" });
			}
			return updated;
		}),

	/** Remove the provider (cascades to the gitea credentials row). */
	remove: protectedProcedure.input(giteaIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		const removed = await removeGitea(input.giteaId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Gitea provider not found" });
		}
		return removed;
	}),

	/** Repositories visible to the configured token. */
	listRepositories: protectedProcedure.input(giteaIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await getGiteaRepositories(input.giteaId, organizationId);
	}),

	/** Branches of one repository. */
	listBranches: protectedProcedure
		.input(giteaIdInput.extend({ owner: z.string().min(1), repo: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
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
		await assertOrgRole(ctx.session.user.id, organizationId, "admin");
		return await testGiteaConnection(input.giteaId, organizationId);
	}),
});
