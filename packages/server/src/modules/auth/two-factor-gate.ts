import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { members, organizations, users } from "../../db/schema";

/**
 * Org-level 2FA enforcement. When an organization sets `requireTwoFactor`,
 * members whose account has no 2FA enabled are blocked from every org-scoped
 * procedure (tRPC middleware) and shown a setup interstitial (dashboard
 * layout) until they enable it. 2FA setup itself runs through better-auth
 * routes, so a gated member can always escape the gate.
 */

export const TWO_FACTOR_REQUIRED_MESSAGE =
	"Two-factor authentication is required by your organization — set it up in your profile to continue";

/** Pure gate predicate — unit-tested, no I/O. */
export function shouldRequireTwoFactorSetup(input: {
	orgRequiresTwoFactor: boolean;
	userTwoFactorEnabled: boolean | null | undefined;
}): boolean {
	return input.orgRequiresTwoFactor && !input.userTwoFactorEnabled;
}

/** DB-backed gate check for one user against one organization. */
export async function isTwoFactorGateBlocked(
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const [row] = await db
		.select({
			requireTwoFactor: organizations.requireTwoFactor,
			twoFactorEnabled: users.twoFactorEnabled,
		})
		.from(members)
		.innerJoin(organizations, eq(organizations.id, members.organizationId))
		.innerJoin(users, eq(users.id, members.userId))
		.where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)))
		.limit(1);
	if (!row) return false; // not a member — tenancy checks elsewhere handle that
	return shouldRequireTwoFactorSetup({
		orgRequiresTwoFactor: row.requireTwoFactor,
		userTwoFactorEnabled: row.twoFactorEnabled,
	});
}
