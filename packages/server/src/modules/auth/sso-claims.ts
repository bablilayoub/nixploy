import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { accounts } from "../../db/schema";

/**
 * Reading the IdP's claims back out of the stored ID token.
 *
 * The group claim only exists in the OAuth profile, which better-auth hands to
 * `mapProfileToUser` — and that hook does not run for a user who already
 * exists, so it cannot be the source for anything that has to happen on *every*
 * sign-in (role sync, the email allow-list). better-auth does store the raw
 * `id_token` on the account row, though, and that is where the claims came
 * from in the first place.
 *
 * The token is **not** verified here, deliberately: better-auth already
 * validated it against the provider's JWKS before writing the row, and this is
 * reading back something we stored ourselves. Nothing here trusts a token off
 * the wire.
 */

/** Payload of a JWT, without verifying it. Null for anything unparseable. */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
	if (!token) return null;
	const parts = token.split(".");
	if (parts.length < 2 || !parts[1]) return null;
	try {
		const json = Buffer.from(parts[1], "base64url").toString("utf8");
		const parsed: unknown = JSON.parse(json);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Claims of the ID token stored for this user's identity with a provider. */
export async function readStoredIdTokenClaims(
	userId: string,
	providerId: string,
): Promise<Record<string, unknown> | null> {
	const row = await db.query.accounts.findFirst({
		where: and(eq(accounts.userId, userId), eq(accounts.providerId, providerId)),
		columns: { idToken: true },
	});
	return decodeJwtPayload(row?.idToken);
}
