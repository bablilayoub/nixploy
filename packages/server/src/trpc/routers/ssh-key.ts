import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import {
	createSshKey,
	findSshKeyById,
	generateSshKeyPair,
	listSshKeysByOrganization,
	removeSshKey,
	updateSshKeyById,
} from "../../modules/cluster";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const sshKeyIdInput = z.object({ sshKeyId: z.string().min(1) });

/**
 * Response shape: the private key never leaves the server. It is only ever
 * used by the SSH exec layer; clients see the public key and metadata.
 */
const publicSshKey = <T extends { privateKey: string }>(sshKey: T): Omit<T, "privateKey"> => {
	const { privateKey: _privateKey, ...rest } = sshKey;
	return rest;
};

export const sshKeyRouter = router({
	/** All SSH keys of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await listSshKeysByOrganization(organizationId);
		return rows.map(publicSshKey);
	}),

	/** A single SSH key by id. */
	one: protectedProcedure.input(sshKeyIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const sshKey = await findSshKeyById(input.sshKeyId, organizationId);
		if (!sshKey) {
			throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
		}
		return publicSshKey(sshKey);
	}),

	/** Store an existing keypair (private key is encrypted at rest). */
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				description: z.string().nullish(),
				privateKey: z.string().min(1),
				publicKey: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "ssh_keys.manage");
			const created = await createSshKey(
				{
					name: input.name,
					description: input.description ?? null,
					privateKey: input.privateKey,
					publicKey: input.publicKey,
				},
				organizationId,
			);
			if (!created) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create SSH key",
				});
			}
			void auditFromSession(ctx, organizationId, {
				action: "ssh_key.create",
				targetType: "ssh_key",
				targetId: created.sshKeyId,
				targetName: created.name,
			});
			return publicSshKey(created);
		}),

	/** Update name/description (key material is immutable). */
	update: protectedProcedure
		.input(
			z.object({
				sshKeyId: z.string().min(1),
				name: z.string().min(1).optional(),
				description: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "ssh_keys.manage");
			const { sshKeyId, ...values } = input;
			const updated = await updateSshKeyById(sshKeyId, values, organizationId);
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
			}
			return publicSshKey(updated);
		}),

	/** Delete an SSH key (servers referencing it keep working until edited). */
	remove: protectedProcedure.input(sshKeyIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "ssh_keys.manage");
		const removed = await removeSshKey(input.sshKeyId, organizationId);
		if (!removed) {
			throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
		}
		void auditFromSession(ctx, organizationId, {
			action: "ssh_key.delete",
			targetType: "ssh_key",
			targetId: removed.sshKeyId,
			targetName: removed.name,
		});
		return publicSshKey(removed);
	}),

	/**
	 * Generate a fresh ed25519 keypair. The keys are NOT persisted — the
	 * client shows them once and submits them through `create`.
	 */
	generate: protectedProcedure
		.input(z.object({ name: z.string().min(1).optional() }).optional())
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "ssh_keys.manage");
			return await generateSshKeyPair(input?.name);
		}),
});
