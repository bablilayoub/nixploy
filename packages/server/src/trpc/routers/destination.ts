import { isIP } from "node:net";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { destinations } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { testDestination } from "../../modules/backups/runner";
import {
	isLocalDestination,
	LOCAL_PROVIDER,
	localDestinationRoot,
} from "../../modules/backups/storage";
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

const s3Fields = z.object({
	accessKey: z.string().min(1),
	secretAccessKey: z.string().min(1),
	bucket: z.string().min(1),
	region: z.string().min(1),
	endpoint: z.string().min(1),
});

/**
 * `provider: "local"` needs a name only — archives go to the panel host's
 * disk (`<config>/backups/<org>/…`). Everything else is an S3-compatible
 * bucket (the default when `provider` is omitted).
 */
const createDestinationInput = z.union([
	z.object({ name: z.string().min(1), provider: z.literal(LOCAL_PROVIDER) }),
	s3Fields.extend({ name: z.string().min(1), provider: z.literal("s3").optional() }),
]);

/** Provider cannot change after creation; S3 fields are rejected on local rows. */
const updateDestinationInput = s3Fields
	.partial()
	.extend({ destinationId: z.string().min(1), name: z.string().min(1).optional() });

/** Placeholder stored in the (non-null) S3 columns of a local destination. */
const LOCAL_PLACEHOLDER = "local";

/**
 * Response shape: secret key is always write-only. Access key is an
 * identifier for the edit form but still gated behind secrets.read /
 * destinations.manage so viewers cannot harvest credentials. Local
 * destinations expose their on-disk root instead of bucket details.
 */
async function publicDestination<
	T extends {
		secretAccessKey: string;
		accessKey: string;
		provider: string;
		organizationId: string;
	},
>(destination: T, userId: string, organizationId: string) {
	const storagePath = isLocalDestination(destination) ? localDestinationRoot(destination) : null;
	const canSee =
		(await hasCapability(userId, organizationId, "secrets.read")) ||
		(await hasCapability(userId, organizationId, "destinations.manage"));
	if (canSee) {
		const { secretAccessKey: _secretAccessKey, ...rest } = destination;
		return { ...rest, storagePath };
	}
	return { ...redactDestinationSecrets(destination), storagePath };
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

	/**
	 * Add a destination: an S3-compatible bucket (secret key is encrypted at
	 * rest) or, for instance admins, the panel host's local disk.
	 */
	create: protectedProcedure.input(createDestinationInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "destinations.manage");
		let values: typeof destinations.$inferInsert;
		if (input.provider === LOCAL_PROVIDER) {
			// Writes land on the panel host's config volume — platform-level
			// disk, so only the instance admin may point an org at it.
			await assertInstanceAdmin(ctx.session);
			values = {
				name: input.name,
				provider: LOCAL_PROVIDER,
				accessKey: LOCAL_PLACEHOLDER,
				secretAccessKey: LOCAL_PLACEHOLDER,
				bucket: LOCAL_PLACEHOLDER,
				region: LOCAL_PLACEHOLDER,
				endpoint: LOCAL_PLACEHOLDER,
				organizationId,
			};
		} else {
			await assertSafeS3Endpoint(input.endpoint);
			values = { ...input, provider: "s3", organizationId };
		}
		const [row] = await db.insert(destinations).values(values).returning();
		if (!row) {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
		}
		void auditFromSession(ctx, organizationId, {
			action: "destination.create",
			targetType: "destination",
			targetId: row.destinationId,
			targetName: row.name,
			metadata: { provider: row.provider },
		});
		return await publicDestination(row, ctx.session.user.id, organizationId);
	}),

	/** Update destination credentials/settings (local destinations: name only). */
	update: protectedProcedure.input(updateDestinationInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "destinations.manage");
		const { destinationId, ...values } = input;
		const existing = await findDestinationOrThrow(destinationId, organizationId);
		if (isLocalDestination(existing)) {
			const { name: _name, ...s3Values } = values;
			if (Object.values(s3Values).some((value) => value !== undefined)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A local destination has no bucket settings to update",
				});
			}
		}
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
		void auditFromSession(ctx, organizationId, {
			action: "destination.update",
			targetType: "destination",
			targetId: destinationId,
			targetName: row?.name ?? existing.name,
			metadata: {
				provider: existing.provider,
				credentialsChanged: values.accessKey !== undefined || values.secretAccessKey !== undefined,
				endpointChanged: values.endpoint !== undefined,
			},
		});
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

	/** Verify the destination: ListObjects probe (S3) or a write probe on disk (local). */
	testConnection: protectedProcedure.input(destinationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "destinations.manage");
		const row = await findDestinationOrThrow(input.destinationId, organizationId);
		void auditFromSession(ctx, organizationId, {
			action: "destination.testConnection",
			targetType: "destination",
			targetId: row.destinationId,
			targetName: row.name,
			metadata: { provider: row.provider },
		});
		return await testDestination(row);
	}),
});
