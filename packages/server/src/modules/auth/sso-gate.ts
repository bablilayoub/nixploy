import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { accounts, members, organizations, users } from "../../db/schema";
import { isInstanceAdminRole } from "./instance-admin";
import { loadSsoProviders } from "./sso";

/**
 * Org-level SSO enforcement, and the guard that stops an operator enabling it
 * on an organization nobody could then get back into.
 *
 * Mirrors `two-factor-gate.ts`: when an organization sets `requireSso`, members
 * who did not arrive through an IdP are blocked from every org-scoped procedure
 * and shown an interstitial. Instance admins are exempt — they are the
 * break-glass path when the IdP is down, and an org that can lock out every one
 * of its owners is a support ticket waiting to happen.
 */

export const SSO_REQUIRED_MESSAGE =
	"Your organization requires single sign-on — sign in through your identity provider to continue";

/** Pure gate predicate — unit-tested, no I/O. */
export function shouldRequireSsoSignIn(input: {
	orgRequiresSso: boolean;
	/** The user has at least one linked SSO identity. */
	hasSsoAccount: boolean;
	/** Instance admins are never gated (break-glass). */
	isInstanceAdmin: boolean;
}): boolean {
	if (!input.orgRequiresSso) return false;
	if (input.isInstanceAdmin) return false;
	return !input.hasSsoAccount;
}

/**
 * Provider ids that count as "signed in through SSO".
 *
 * better-auth stores one `account` row per identity, with `providerId` set to
 * `credential` for a password and to the social provider's id otherwise. So
 * the question is whether the user has an account row matching one of the
 * configured SSO providers — a row for a provider that has since been deleted
 * does not count, because that identity can no longer be used to sign in.
 */
async function ssoProviderIds(): Promise<string[]> {
	return (await loadSsoProviders()).map((provider) => provider.providerId);
}

/** Whether this user has a usable SSO identity. */
export async function hasLinkedSsoAccount(userId: string): Promise<boolean> {
	const providerIds = await ssoProviderIds();
	if (providerIds.length === 0) return false;
	const row = await db.query.accounts.findFirst({
		where: and(eq(accounts.userId, userId), inArray(accounts.providerId, providerIds)),
		columns: { id: true },
	});
	return Boolean(row);
}

/** DB-backed gate check for one user against one organization. */
export async function isSsoGateBlocked(userId: string, organizationId: string): Promise<boolean> {
	const [row] = await db
		.select({ requireSso: organizations.requireSso, userRole: users.role })
		.from(members)
		.innerJoin(organizations, eq(organizations.id, members.organizationId))
		.innerJoin(users, eq(users.id, members.userId))
		.where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)))
		.limit(1);
	if (!row) return false; // not a member — tenancy checks elsewhere handle that
	if (!row.requireSso) return false;
	if (isInstanceAdminRole(row.userRole)) return false;
	return !(await hasLinkedSsoAccount(userId));
}

/* -------------------------------------------------------------------------- */
/*  Lockout guard                                                             */
/* -------------------------------------------------------------------------- */

export interface SsoLockoutCheck {
	/** Whether "require SSO" may be turned on. */
	allowed: boolean;
	/** Why not, in words an operator can act on. */
	reason?: string;
}

/**
 * Whether enabling "require SSO" would leave anyone able to administer this
 * organization.
 *
 * The rule is deliberately conservative: at least one member ranked `admin` or
 * `owner` must either already have a linked SSO identity or be an instance
 * admin (who is exempt from the gate and can always get back in). An org whose
 * only owner signs in with a password would otherwise lock itself out the
 * moment the switch is flipped — and the person who could turn it off is the
 * person who can no longer get in.
 *
 * Pure so the decision is testable without a database; the caller supplies the
 * members.
 */
export function checkSsoLockout(
	members: ReadonlyArray<{
		role: string;
		userRole: string | null;
		hasSsoAccount: boolean;
	}>,
	providerCount: number,
): SsoLockoutCheck {
	if (providerCount === 0) {
		return {
			allowed: false,
			reason:
				"This instance has no SSO provider configured yet — add one before requiring it, or nobody will be able to sign in.",
		};
	}
	const administrators = members.filter(
		(member) => member.role === "admin" || member.role === "owner",
	);
	if (administrators.length === 0) {
		return {
			allowed: false,
			reason: "This organization has no admin or owner to enforce the requirement against.",
		};
	}
	const canStillGetIn = administrators.some(
		(member) => member.hasSsoAccount || isInstanceAdminRole(member.userRole),
	);
	if (!canStillGetIn) {
		return {
			allowed: false,
			reason:
				"No admin or owner of this organization has signed in through SSO yet. Sign in once with your identity provider first — otherwise turning this on locks everyone out, including whoever would turn it off.",
		};
	}
	return { allowed: true };
}

/** {@link checkSsoLockout}, with the members read from the database. */
export async function checkSsoLockoutForOrganization(
	organizationId: string,
): Promise<SsoLockoutCheck> {
	const providerIds = await ssoProviderIds();
	const rows = await db
		.select({ userId: members.userId, role: members.role, userRole: users.role })
		.from(members)
		.innerJoin(users, eq(users.id, members.userId))
		.where(eq(members.organizationId, organizationId));

	const administrators = rows.filter((row) => row.role === "admin" || row.role === "owner");
	const linked =
		providerIds.length > 0 && administrators.length > 0
			? new Set(
					(
						await db
							.select({ userId: accounts.userId })
							.from(accounts)
							.where(
								and(
									inArray(
										accounts.userId,
										administrators.map((row) => row.userId),
									),
									inArray(accounts.providerId, providerIds),
								),
							)
					).map((row) => row.userId),
				)
			: new Set<string>();

	return checkSsoLockout(
		rows.map((row) => ({
			role: row.role,
			userRole: row.userRole,
			hasSsoAccount: linked.has(row.userId),
		})),
		providerIds.length,
	);
}
