import { buildApiKeyContext } from "@nixploy/server/lib/api-key-context";
import { recordAudit } from "@nixploy/server/modules/audit/index";
import {
	isTwoFactorGateBlocked,
	TWO_FACTOR_REQUIRED_MESSAGE,
} from "@nixploy/server/modules/auth/two-factor-gate";
import { isDomainError } from "@nixploy/server/modules/errors";
import { MAX_DUMP_BYTES, storeDump } from "@nixploy/server/modules/import/dump-store";
import {
	hasCapability,
	resolveCallerOrganizationId,
	runWithCapabilityScope,
} from "@nixploy/server/modules/projects/index";
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

/**
 * Upload a database dump of another panel for the offline importer
 * (`docs/migrate-from-another-panel.md`). Raw body, `application/octet-stream`
 * (or gzip); the file name rides in `x-nixploy-filename`. Stored under the
 * caller's organisation for 24 hours; `import.inspect` / `plan` / `runApply`
 * take the returned `dumpId` instead of a url + key.
 */
export async function POST(req: Request) {
	const ip = clientIpFromRequest(req);
	if (!takeIpRateLimitToken("import-dump", ip, { windowMs: 60_000, max: 10 })) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	let userId: string | undefined;
	let activeOrganizationId: string | null | undefined;
	let boundOrganizationId: string | null = null;
	let capabilityScope: Awaited<ReturnType<typeof buildApiKeyContext>>["capabilityScope"];

	const session = await getSession().catch(() => null);
	if (session?.user?.id) {
		userId = session.user.id;
		activeOrganizationId = session.session.activeOrganizationId;
	} else {
		try {
			const ctx = await buildApiKeyContext(req, { bucket: "import-dump-key", allowBearer: true });
			userId = ctx.session?.user.id;
			activeOrganizationId = ctx.session?.session.activeOrganizationId;
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
	if (!takeRateLimitToken(`import-dump:user:${userId}`, { windowMs: 60_000, max: 10 })) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	const organizationId = await resolveCallerOrganizationId(userId, activeOrganizationId ?? null);
	if (boundOrganizationId && boundOrganizationId !== organizationId) {
		return Response.json({ message: "Forbidden" }, { status: 403 });
	}
	if (await isTwoFactorGateBlocked(userId, organizationId)) {
		return Response.json({ message: TWO_FACTOR_REQUIRED_MESSAGE }, { status: 403 });
	}
	// The same gate as the importer's procedures: an import is a GitOps apply
	// from another panel, and the dump holds that panel's whole database.
	const allowed = capabilityScope
		? await runWithCapabilityScope(capabilityScope, () =>
				hasCapability(userId, organizationId, "gitops.manage"),
			)
		: await hasCapability(userId, organizationId, "gitops.manage");
	if (!allowed) {
		return Response.json(
			{ message: 'This action requires the "gitops.manage" capability' },
			{ status: 403 },
		);
	}

	const declared = Number.parseInt(req.headers.get("content-length") ?? "", 10);
	if (Number.isFinite(declared) && declared > MAX_DUMP_BYTES) {
		return Response.json(
			{ message: `The dump exceeds ${MAX_DUMP_BYTES / 1024 / 1024} MiB` },
			{ status: 413 },
		);
	}
	const body = Buffer.from(await req.arrayBuffer());
	if (body.length > MAX_DUMP_BYTES) {
		return Response.json(
			{ message: `The dump exceeds ${MAX_DUMP_BYTES / 1024 / 1024} MiB` },
			{ status: 413 },
		);
	}
	const filename = req.headers.get("x-nixploy-filename") ?? "dump.sql";

	try {
		const stored = await storeDump(organizationId, filename, body);
		void recordAudit({
			actorId: userId,
			organizationId,
			action: "import.uploadDump",
			targetType: "import",
			targetId: stored.dumpId,
			targetName: stored.filename,
			metadata: { bytes: stored.bytes, format: stored.format, gzipped: stored.gzipped },
		});
		return Response.json({
			dumpId: stored.dumpId,
			filename: stored.filename,
			bytes: stored.bytes,
			format: stored.format,
			gzipped: stored.gzipped,
			expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
		});
	} catch (error) {
		if (isDomainError(error)) {
			return Response.json(
				{ message: error.message },
				{
					status: getHTTPStatusCodeFromError(
						new TRPCError({ code: error.code, message: error.message }),
					),
				},
			);
		}
		throw error;
	}
}
