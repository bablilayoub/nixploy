import { isIP } from "node:net";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { destinations } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { testDestination } from "../../modules/backups/runner";
import {
	assertCapability,
	hasCapability,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import {
	assertPublicIp,
	assertSafeOutboundUrl,
	isCloudMetadataHostname,
} from "../../utils/public-url";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";
import { redactDestinationSecrets } from "../redact-secrets";

type Session = NonNullable<TRPCContext["session"]>;

async function assertSafeS3Endpoint(endpoint: string): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid S3 endpoint URL" });
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new TRPCError({ code: "BAD_REQUEST", message: "S3 endpoint must be http(s)" });
	}
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (isCloudMetadataHostname(host)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "S3 endpoint must not target cloud metadata",
		});
	}
	// Self-hosted MinIO on LAN/loopback (literal hosts only).
	if (host === "localhost" || host.endsWith(".localhost")) {
		return;
	}
	if (isIP(host)) {
		try {
			assertPublicIp(host);
		} catch {
			return;
		}
	}
	try {
		await assertSafeOutboundUrl(endpoint, {
			allowHttp: parsed.protocol === "http:",
			allowPrivate: false,
		});
	} catch {
		throw new TRPCError({ code: "BAD_REQUEST", message: "S3 endpoint host is not allowed" });
	}
}

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

async function findDestinationOrThrow(destinationId: string, organizationId: string) {
	const row = await db.query.destinations.findFirst({
		where: and(
			eq(destinations.destinationId, destinationId),
			eq(destinations.organizationId, organizationId),
		),
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found" });
	}
	return row;
}

const destinationIdInput = z.object({ destinationId: z.string().min(1) });

const createDestinationInput = z.object({
	name: z.string().min(1),
	accessKey: z.string().min(1),
	secretAccessKey: z.string().min(1),
	bucket: z.string().min(1),
	region: z.string().min(1),
	endpoint: z.string().min(1),
	provider: z.string().optional(),
});

/**
 * Response shape: secret key is always write-only. Access key is an
 * identifier for the edit form but still gated behind secrets.read /
 * destinations.manage so viewers cannot harvest credentials.
 */
async function publicDestination<T extends { secretAccessKey: string; accessKey: string }>(
	destination: T,
	userId: string,
	organizationId: string,
) {
	const canSee =
		(await hasCapability(userId, organizationId, "secrets.read")) ||
		(await hasCapability(userId, organizationId, "destinations.manage"));
	if (canSee) {
		const { secretAccessKey: _secretAccessKey, ...rest } = destination;
		return rest;
	}
	return redactDestinationSecrets(destination);
}

export const destinationRouter = router({
	/** All S3 destinations of the caller's organization. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const rows = await db.query.destinations.findMany({
			where: eq(destinations.organizationId, organizationId),
			orderBy: [desc(destinations.createdAt)],
		});
		return await Promise.all(
			rows.map((row) => publicDestination(row, ctx.session.user.id, organizationId)),
		);
	}),

	/** A single destination by id. */
	one: protectedProcedure.input(destinationIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		return await publicDestination(
			await findDestinationOrThrow(input.destinationId, organizationId),
			ctx.session.user.id,
			organizationId,
		);
	}),

	/** Add an S3-compatible destination (secret key is encrypted at rest). */
	create: protectedProcedure.input(createDestinationInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "destinations.manage");
		await assertSafeS3Endpoint(input.endpoint);
		const [row] = await db
			.insert(destinations)
			.values({ ...input, organizationId })
			.returning();
		if (!row) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
		}
		return await publicDestination(row, ctx.session.user.id, organizationId);
	}),

	/** Update destination credentials/settings. */
	update: protectedProcedure
		.input(createDestinationInput.partial().extend({ destinationId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "destinations.manage");
			const { destinationId, ...values } = input;
			await findDestinationOrThrow(destinationId, organizationId);
			if (values.endpoint) {
				await assertSafeS3Endpoint(values.endpoint);
			}
			const [row] = await db
				.update(destinations)
				.set(values)
				.where(
					and(
						eq(destinations.destinationId, destinationId),
						eq(destinations.organizationId, organizationId),
					),
				)
				.returning();
			return row ? await publicDestination(row, ctx.session.user.id, organizationId) : row;
		}),

	/** Remove a destination (backups pointing at it cascade-delete). */
	remove: protectedProcedure.input(destinationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "destinations.manage");
		const row = await publicDestination(
			await findDestinationOrThrow(input.destinationId, organizationId),
			ctx.session.user.id,
			organizationId,
		);
		await db
			.delete(destinations)
			.where(
				and(
					eq(destinations.destinationId, input.destinationId),
					eq(destinations.organizationId, organizationId),
				),
			);
		void auditFromSession(ctx, organizationId, {
			action: "destination.delete",
			targetType: "destination",
			targetId: input.destinationId,
			targetName: row.name,
		});
		return row;
	}),

	/** Verify bucket access with the stored credentials (ListObjects probe). */
	testConnection: protectedProcedure.input(destinationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "destinations.manage");
		const row = await findDestinationOrThrow(input.destinationId, organizationId);
		return await testDestination(row);
	}),
});
