import { auth } from "@nixploy/server/auth";
import { db } from "@nixploy/server/db";
import { users } from "@nixploy/server/schema";
import { eq } from "drizzle-orm";

/**
 * Verify the caller's API key — `x-api-key` header or
 * `Authorization: Bearer <key>` — through the same better-auth api-key
 * verification the REST adapter (apps/web/src/app/api/[...rest]/route.ts)
 * uses. Returns the key owner's user id, or an error Response.
 *
 * Callers must still scope whatever they act on to that user's
 * organizations: a valid key alone says nothing about tenancy.
 */
export async function authenticateApiKey(req: Request): Promise<{ userId: string } | Response> {
	const bearer = req.headers.get("authorization");
	const key =
		req.headers.get("x-api-key") ??
		(bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length).trim() : null);
	if (!key) {
		return Response.json({ message: "Missing API key" }, { status: 401 });
	}

	const result = (await auth.api.verifyApiKey({ body: { key } })) as {
		valid: boolean;
		key: { id: string; referenceId?: string; userId?: string } | null;
	};
	if (!result.valid || !result.key) {
		return Response.json({ message: "Invalid or expired API key" }, { status: 401 });
	}

	// @better-auth/api-key >= 1.6 exposes the owner as referenceId.
	const userId = result.key.referenceId ?? result.key.userId;
	if (!userId) {
		return Response.json({ message: "Unknown API key owner" }, { status: 401 });
	}

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true, banned: true, banExpires: true },
	});
	if (!user) {
		return Response.json({ message: "Unknown API key owner" }, { status: 401 });
	}
	const banned =
		user.banned === true && (user.banExpires == null || user.banExpires.getTime() > Date.now());
	if (banned) {
		return Response.json({ message: "User is banned" }, { status: 403 });
	}

	return { userId };
}
