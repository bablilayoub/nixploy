import { recordAudit } from "@nixploy/server/modules/audit/index";
import { isInstanceAdminRole } from "@nixploy/server/modules/auth/instance-admin";
import {
	BRANDING_ASSET_SLOTS,
	type BrandingAssetSlot,
	MAX_BRANDING_ASSET_BYTES,
	saveBrandingAsset,
} from "@nixploy/server/modules/branding/index";
import { isDomainError } from "@nixploy/server/modules/errors";
import { clientIpFromRequest, takeIpRateLimitToken } from "@nixploy/server/utils/rate-limit";

import { getSession } from "@/lib/auth-server";

/**
 * Upload a branding asset (logo or favicon).
 *
 * A route handler rather than a tRPC procedure because the payload is binary:
 * the REST adapter caps bodies at 1 MiB and superjson would base64 it.
 *
 * Session only, deliberately — no API-key path. An API key is for automation,
 * and nothing about a deploy pipeline needs to replace the panel's logo; every
 * key that could do it is another way to put an image on the login page of an
 * instance its owner is not looking at.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isSlot = (value: string): value is BrandingAssetSlot =>
	(BRANDING_ASSET_SLOTS as readonly string[]).includes(value);

export async function POST(
	request: Request,
	context: { params: Promise<{ slot: string }> },
): Promise<Response> {
	const { slot } = await context.params;
	if (!isSlot(slot)) {
		return Response.json({ message: "Unknown branding slot" }, { status: 400 });
	}

	const ip = clientIpFromRequest(request);
	if (!takeIpRateLimitToken("branding-upload", ip, { windowMs: 60_000, max: 20 })) {
		return Response.json({ message: "Too many uploads" }, { status: 429 });
	}

	const session = await getSession();
	if (!session) {
		return Response.json({ message: "Unauthorized" }, { status: 401 });
	}
	if (!isInstanceAdminRole((session.user as { role?: string | null }).role)) {
		return Response.json(
			{ message: "This action requires the instance admin role" },
			{ status: 403 },
		);
	}

	// Length is checked before reading the body as well as after: a declared
	// length lets an oversized upload be refused without buffering it.
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(declared) && declared > MAX_BRANDING_ASSET_BYTES * 2) {
		return Response.json({ message: "File is too large" }, { status: 413 });
	}

	let bytes: Buffer;
	try {
		const contentType = request.headers.get("content-type") ?? "";
		if (contentType.includes("multipart/form-data")) {
			const form = await request.formData();
			const file = form.get("file");
			if (!(file instanceof Blob)) {
				return Response.json({ message: "No file in the request" }, { status: 400 });
			}
			bytes = Buffer.from(await file.arrayBuffer());
		} else {
			bytes = Buffer.from(await request.arrayBuffer());
		}
	} catch {
		return Response.json({ message: "Could not read the upload" }, { status: 400 });
	}

	try {
		const saved = await saveBrandingAsset(slot, bytes);
		void recordAudit({
			actorId: session.user.id,
			actorEmail: session.user.email,
			action: "branding.uploadAsset",
			targetType: "instanceBranding",
			// Bytes and the slot only — never the image.
			metadata: { slot, bytes: bytes.length, contentType: saved.contentType },
		});
		return Response.json({ slot, bytes: bytes.length });
	} catch (error) {
		if (isDomainError(error)) {
			return Response.json(
				{ message: error.message },
				{ status: error.code === "PAYLOAD_TOO_LARGE" ? 413 : 400 },
			);
		}
		return Response.json({ message: "Could not store the asset" }, { status: 500 });
	}
}
