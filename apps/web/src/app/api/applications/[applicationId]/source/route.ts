import { buildApiKeyContext } from "@nixploy/server/lib/api-key-context";
import { findApplicationForUser } from "@nixploy/server/modules/application/org";
import { recordAudit } from "@nixploy/server/modules/audit/index";
import {
	isTwoFactorGateBlocked,
	TWO_FACTOR_REQUIRED_MESSAGE,
} from "@nixploy/server/modules/auth/two-factor-gate";
import { MAX_DROP_ARCHIVE_BYTES, storeDropArchive } from "@nixploy/server/modules/deployment/drop";
import { isDomainError } from "@nixploy/server/modules/errors";
import { hasCapability, runWithCapabilityScope } from "@nixploy/server/modules/projects/index";
import {
	clientIpFromRequest,
	takeIpRateLimitToken,
	takeRateLimitToken,
} from "@nixploy/server/utils/rate-limit";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

import { getSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
	params: Promise<{ applicationId: string }>;
}

/**
 * Upload the source archive of a `drop` application:
 * `POST /api/applications/<id>/source` with the zip as the raw body, or as
 * `file` in a multipart form.
 *
 * A route handler rather than a tRPC procedure because the payload is binary
 * and can be hundreds of megabytes — the REST adapter caps bodies at 1 MiB and
 * superjson would base64 it. Authentication still matches every other surface:
 * a browser session, or an API key through `buildApiKeyContext` so key scopes,
 * the org binding, per-key rate limits and the 2FA gate all apply.
 */
export async function POST(req: Request, { params }: RouteParams) {
	const ip = clientIpFromRequest(req);
	if (!takeIpRateLimitToken("drop-upload", ip, { windowMs: 60_000, max: 20 })) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	// Browser session first; fall back to an API key for CI callers.
	let userId: string | undefined;
	let boundOrganizationId: string | null = null;
	let capabilityScope: Awaited<ReturnType<typeof buildApiKeyContext>>["capabilityScope"];

	const session = await getSession().catch(() => null);
	if (session?.user?.id) {
		userId = session.user.id;
	} else {
		try {
			const ctx = await buildApiKeyContext(req, { bucket: "drop-upload-key", allowBearer: true });
			userId = ctx.session?.user.id;
			boundOrganizationId = ctx.apiKey.organizationId;
			capabilityScope = ctx.capabilityScope;
		} catch (error) {
			if (error instanceof TRPCError) {
				return Response.json(
					{ message: error.message },
					{ status: getHTTPStatusCodeFromError(error) },
				);
			}
			throw error;
		}
	}
	if (!userId) {
		return Response.json({ message: "Authentication required" }, { status: 401 });
	}
	if (!takeRateLimitToken(`drop-upload:user:${userId}`, { windowMs: 60_000, max: 20 })) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	const { applicationId } = await params;
	// The org comes from the application, so resolve through the caller's
	// memberships first and re-check the key's org binding after.
	const application = await findApplicationForUser(applicationId, userId);
	if (!application) {
		return Response.json({ message: "Application not found" }, { status: 404 });
	}
	const organizationId = application.environment.project.organizationId;
	if (boundOrganizationId && boundOrganizationId !== organizationId) {
		return Response.json({ message: "Application not found" }, { status: 404 });
	}
	if (await isTwoFactorGateBlocked(userId, organizationId)) {
		return Response.json({ message: TWO_FACTOR_REQUIRED_MESSAGE }, { status: 403 });
	}
	const canWrite = capabilityScope
		? await runWithCapabilityScope(capabilityScope, () =>
				hasCapability(userId, organizationId, "service.write"),
			)
		: await hasCapability(userId, organizationId, "service.write");
	if (!canWrite) {
		return Response.json({ message: "Application not found" }, { status: 404 });
	}
	if (application.sourceType !== "drop") {
		return Response.json(
			{ message: "This application's source type is not drop (zip upload)" },
			{ status: 409 },
		);
	}

	// Refuse an oversized upload from the header before reading the body.
	const declared = Number.parseInt(req.headers.get("content-length") ?? "", 10);
	if (Number.isInteger(declared) && declared > MAX_DROP_ARCHIVE_BYTES) {
		return Response.json({ message: "Archive is too large" }, { status: 413 });
	}

	let archive: Buffer;
	try {
		const contentType = req.headers.get("content-type") ?? "";
		if (contentType.includes("multipart/form-data")) {
			const form = await req.formData();
			const file = form.get("file");
			if (!(file instanceof File)) {
				return Response.json({ message: "Expected a `file` field" }, { status: 400 });
			}
			archive = Buffer.from(await file.arrayBuffer());
		} else {
			archive = Buffer.from(await req.arrayBuffer());
		}
	} catch {
		return Response.json({ message: "Could not read the uploaded archive" }, { status: 400 });
	}

	let bytes: number;
	try {
		bytes = await storeDropArchive(application.appName, archive);
	} catch (error) {
		if (isDomainError(error)) {
			return Response.json(
				{ message: error.message },
				{ status: error.code === "PAYLOAD_TOO_LARGE" ? 413 : 400 },
			);
		}
		throw error;
	}

	// Size only — the archive is tenant source, never its contents.
	await recordAudit({
		actorId: userId,
		organizationId,
		action: "application.uploadSource",
		targetType: "application",
		targetId: application.applicationId,
		targetName: application.name,
		metadata: { bytes },
	});

	return Response.json({ applicationId: application.applicationId, bytes });
}
