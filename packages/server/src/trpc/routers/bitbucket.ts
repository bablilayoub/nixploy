import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createBitbucket,
	findBitbucketById,
	getBitbucketBranches,
	getBitbucketRepositories,
	listBitbucketByOrganization,
	removeBitbucket,
	testBitbucketConnection,
	updateBitbucketById,
	updateBitbucketProviderName,
} from "../../modules/git";
import { resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const bitbucketIdInput = z.object({ bitbucketId: z.string().min(1) });

const createBitbucketInput = z.object({
	name: z.string().min(1),
	bitbucketUsername: z.string().nullish(),
	bitbucketWorkspaceName: z.string().nullish(),
	appPassword: z.string().nullish(),
	apiToken: z.string().nullish(),
});

export const bitbucketRouter = router({
	/** All Bitbucket providers of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await listBitbucketByOrganization(organizationId);
	}),

	/** A single Bitbucket provider by id. */
	one: protectedProcedure.input(bitbucketIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findBitbucketById(input.bitbucketId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Bitbucket provider not found" });
		}
		return row;
	}),

	/** Add a Bitbucket Cloud provider (API token or username + app password). */
	create: protectedProcedure.input(createBitbucketInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await createBitbucket(input, organizationId);
	}),

	/** Update credentials and/or the provider name. */
	update: protectedProcedure
		.input(createBitbucketInput.partial().extend({ bitbucketId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const { bitbucketId, name, ...values } = input;
			if (name) {
				await updateBitbucketProviderName(bitbucketId, name, organizationId);
			}
			const updated = await updateBitbucketById(bitbucketId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Bitbucket provider not found" });
			}
			return updated;
		}),

	/** Remove the provider (cascades to the bitbucket credentials row). */
	remove: protectedProcedure.input(bitbucketIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const removed = await removeBitbucket(input.bitbucketId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Bitbucket provider not found" });
		}
		return removed;
	}),

	/** Repositories visible to the configured credentials. */
	listRepositories: protectedProcedure.input(bitbucketIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await getBitbucketRepositories(input.bitbucketId, organizationId);
	}),

	/** Branches of one repository (`workspace` + repo slug). */
	listBranches: protectedProcedure
		.input(bitbucketIdInput.extend({ workspace: z.string().min(1), repoSlug: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			return await getBitbucketBranches({
				bitbucketId: input.bitbucketId,
				organizationId,
				workspace: input.workspace,
				repoSlug: input.repoSlug,
			});
		}),

	/** Verify the configured credentials against the Bitbucket API. */
	testConnection: protectedProcedure.input(bitbucketIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await testBitbucketConnection(input.bitbucketId, organizationId);
	}),
});
