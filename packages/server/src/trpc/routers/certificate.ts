import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { certificates, generateId, servers } from "../../db/schema";
import { getOrganizationId } from "../../modules/application";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { assertCapability } from "../../modules/projects";
import {
	getCertificatesDir,
	REMOTE_TRAEFIK_DIR,
	removeFileOnServer,
	TRAEFIK_CERTIFICATES_CONTAINER_DIR,
	writeFileOnServer,
} from "../../modules/traefik";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { protectedProcedure, router } from "../init";

const certificateIdInput = z.object({ certificateId: z.string().min(1) });

/** Shell-quote a string for POSIX sh (single-quote wrapping). */
const shq = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Certificates belong to the organization that uploaded them, including host
 * certificates (serverId null) that Traefik serves from the shared dynamic
 * directory.
 */
const findCertificate = (certificateId: string) =>
	db.query.certificates.findFirst({
		where: eq(certificates.certificateId, certificateId),
		with: { server: true },
	});

const assertCertificateAccess = async (certificateId: string, organizationId: string) => {
	const certificate = await findCertificate(certificateId);
	if (!certificate || certificate.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
	}
	return certificate;
};

const assertServerAccess = async (serverId: string, organizationId: string) => {
	const server = await db.query.servers.findFirst({
		where: eq(servers.serverId, serverId),
	});
	if (!server || server.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
	}
};

/** Host-side directory Traefik's file provider reads certificates from. */
const hostCertificatesDir = (serverId: string | null): string =>
	serverId ? `${REMOTE_TRAEFIK_DIR}/dynamic/certificates` : getCertificatesDir();

/**
 * Write the cert chain and private key into the dynamic directory (locally
 * or over SSH) so Traefik's file provider picks them up. The key file is
 * chmod 600 — it sits on disk in plaintext by design (Traefik needs it).
 */
const writeCertificateFiles = async (
	certificateId: string,
	certificateData: string,
	privateKey: string,
	serverId: string | null,
): Promise<void> => {
	const dir = hostCertificatesDir(serverId);
	await writeFileOnServer(`${dir}/${certificateId}.crt`, certificateData, serverId);
	await writeFileOnServer(`${dir}/${certificateId}.key`, privateKey, serverId);
	const chmod = `chmod 600 ${shq(`${dir}/${certificateId}.key`)}`;
	if (serverId) {
		await execAsyncRemote(serverId, chmod);
	} else {
		await execAsync(chmod);
	}
};

const removeCertificateFiles = async (
	certificateId: string,
	serverId: string | null,
): Promise<void> => {
	const dir = hostCertificatesDir(serverId);
	await removeFileOnServer(`${dir}/${certificateId}.crt`, serverId).catch(() => {});
	await removeFileOnServer(`${dir}/${certificateId}.key`, serverId).catch(() => {});
};

/** Response shape: never ship the private key back to the client. */
const publicCertificate = <T extends { privateKey: string; server?: unknown }>(
	certificate: T,
): Omit<T, "privateKey" | "server"> & { serverName: string | null } => {
	const { privateKey: _privateKey, server, ...rest } = certificate;
	const serverName =
		server && typeof server === "object" && "name" in server
			? String((server as { name: unknown }).name)
			: null;
	return { ...rest, serverName };
};

export const certificateRouter = router({
	/** Every certificate owned by the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await db.query.certificates.findMany({
			where: eq(certificates.organizationId, organizationId),
			with: { server: { columns: { organizationId: true, name: true } } },
			orderBy: desc(certificates.createdAt),
		});
		return rows.map(publicCertificate);
	}),

	one: protectedProcedure.input(certificateIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const certificate = await assertCertificateAccess(input.certificateId, organizationId);
		return publicCertificate(certificate);
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				/** PEM certificate chain (leaf first), written as `<id>.crt`. */
				certificateData: z.string().min(1),
				/** PEM private key (encrypted at rest), written as `<id>.key`. */
				privateKey: z.string().min(1),
				autoRenew: z.boolean().optional(),
				serverId: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "certificates.manage");
			const serverId = input.serverId ?? null;
			if (serverId) {
				await assertServerAccess(serverId, organizationId);
			} else {
				// Host Traefik cert store is instance-wide.
				await assertInstanceAdmin(ctx.session);
			}

			const certificateId = generateId();
			// Container-side path: Traefik reads it from the fixed mount target.
			const certificatePath = `${TRAEFIK_CERTIFICATES_CONTAINER_DIR}/${certificateId}.crt`;

			await writeCertificateFiles(certificateId, input.certificateData, input.privateKey, serverId);
			try {
				const [certificate] = await db
					.insert(certificates)
					.values({
						certificateId,
						name: input.name,
						certificateData: input.certificateData,
						privateKey: input.privateKey,
						certificatePath,
						autoRenew: input.autoRenew ?? false,
						organizationId,
						serverId,
					})
					.returning();
				if (!certificate) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create certificate",
					});
				}
				return publicCertificate(certificate);
			} catch (error) {
				await removeCertificateFiles(certificateId, serverId);
				throw error;
			}
		}),

	update: protectedProcedure
		.input(
			certificateIdInput.extend({
				name: z.string().min(1).optional(),
				certificateData: z.string().min(1).optional(),
				privateKey: z.string().min(1).optional(),
				autoRenew: z.boolean().optional(),
				serverId: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "certificates.manage");
			const existing = await assertCertificateAccess(input.certificateId, organizationId);

			const nextServerId = input.serverId !== undefined ? input.serverId : existing.serverId;
			if (nextServerId) {
				await assertServerAccess(nextServerId, organizationId);
			} else {
				await assertInstanceAdmin(ctx.session);
			}

			// Re-materialize the files when the PEM data or the target server changed.
			if (
				input.certificateData !== undefined ||
				input.privateKey !== undefined ||
				nextServerId !== existing.serverId
			) {
				await writeCertificateFiles(
					existing.certificateId,
					input.certificateData ?? existing.certificateData,
					input.privateKey ?? existing.privateKey,
					nextServerId,
				);
				if (nextServerId !== existing.serverId) {
					await removeCertificateFiles(existing.certificateId, existing.serverId);
				}
			}

			const { certificateId, ...fields } = input;
			const [certificate] = await db
				.update(certificates)
				.set(fields)
				.where(eq(certificates.certificateId, certificateId))
				.returning();
			if (!certificate) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to update certificate",
				});
			}
			return publicCertificate(certificate);
		}),

	delete: protectedProcedure.input(certificateIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "certificates.manage");
		const certificate = await assertCertificateAccess(input.certificateId, organizationId);
		if (!certificate.serverId) {
			await assertInstanceAdmin(ctx.session);
		}

		await db.delete(certificates).where(eq(certificates.certificateId, input.certificateId));
		await removeCertificateFiles(certificate.certificateId, certificate.serverId);
		return { certificateId: input.certificateId };
	}),
});
