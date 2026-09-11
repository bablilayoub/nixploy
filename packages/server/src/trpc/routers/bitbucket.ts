import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
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
import { derivedWebhookSecret } from "../../modules/git/webhook-secret";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
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

/** Response shape: credentials and webhook secret are write-only. */
const publicBitbucket = <
	T extends {
		bitbucketId: string;
		appPassword: string | null;
		apiToken: string | null;
	},
>(
	row: T,
) => {
	const { appPassword, apiToken, ...rest } = row;
	return {
		...rest,
		appPasswordConfigured: Boolean(appPassword),
		apiTokenConfigured: Boolean(apiToken),
		webhookSecretConfigured: true,
	};
};

export const bitbucketRouter = router({
	/** All Bitbucket providers of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await listBitbucketByOrganization(organizationId);
		return rows.map(({ bitbucket: row, gitProvider }) => ({
			bitbucket: publicBitbucket(row),
			gitProvider,
		}));
	}),

	/** A single Bitbucket provider by id. */
	one: protectedProcedure.input(bitbucketIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findBitbucketById(input.bitbucketId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Bitbucket provider not found" });
		}
		return publicBitbucket(row);
	}),

	/** Add a Bitbucket Cloud provider (API token or username + app password). */
	create: protectedProcedure.input(createBitbucketInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const created = await createBitbucket(input, organizationId);
		if (!created.bitbucket) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to create Bitbucket provider",
			});
		}
		void auditFromSession(ctx, organizationId, {
			action: "bitbucket.create",
			targetType: "gitProvider",
			targetId: created.bitbucket.bitbucketId,
			targetName: created.gitProvider.name,
		});
		return { gitProvider: created.gitProvider, bitbucket: publicBitbucket(created.bitbucket) };
	}),

	/** Update credentials and/or the provider name. */
	update: protectedProcedure
		.input(createBitbucketInput.partial().extend({ bitbucketId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
			const { bitbucketId, name, ...values } = input;
			if (name) {
				await updateBitbucketProviderName(bitbucketId, name, organizationId);
			}
			const updated = await updateBitbucketById(bitbucketId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Bitbucket provider not found" });
			}
			void auditFromSession(ctx, organizationId, {
				action: "bitbucket.update",
				targetType: "gitProvider",
				targetId: bitbucketId,
				targetName: name ?? null,
				metadata: {
					credentialsChanged: values.apiToken !== undefined || values.appPassword !== undefined,
				},
			});
			return publicBitbucket(updated);
		}),

	/** Remove the provider (cascades to the bitbucket credentials row). */
	remove: protectedProcedure.input(bitbucketIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const removed = await removeBitbucket(input.bitbucketId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Bitbucket provider not found" });
		}
		void auditFromSession(ctx, organizationId, {
			action: "bitbucket.delete",
			targetType: "gitProvider",
			targetId: input.bitbucketId,
		});
		return publicBitbucket(removed);
	}),

	/** Repositories visible to the configured credentials. */
	listRepositories: protectedProcedure.input(bitbucketIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.create");
		return await getBitbucketRepositories(input.bitbucketId, organizationId);
	}),

	/** Branches of one repository (`workspace` + repo slug). */
	listBranches: protectedProcedure
		.input(bitbucketIdInput.extend({ workspace: z.string().min(1), repoSlug: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.create");
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
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		void auditFromSession(ctx, organizationId, {
			action: "bitbucket.testConnection",
			targetType: "gitProvider",
			targetId: input.bitbucketId,
		});
		return await testBitbucketConnection(input.bitbucketId, organizationId);
	}),

	/**
	 * Reveal the derived Bearer webhook secret for webhook setup.
	 * Gated — viewers must not forge Bitbucket deliveries.
	 */
	revealWebhookSecret: protectedProcedure.input(bitbucketIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "git_providers.manage");
		const row = await findBitbucketById(input.bitbucketId, organizationId);
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Bitbucket provider not found" });
		}
		return { webhookSecret: derivedWebhookSecret("bitbucket", row.bitbucketId) };
	}),
});
