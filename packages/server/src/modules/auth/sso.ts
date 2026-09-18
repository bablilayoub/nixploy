import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { members, organizations, ssoProviders } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { ORG_ROLE_RANK, type OrgRole, orgRoleRank } from "../projects/roles";
import { discoveryUrlForIssuer, isSsoPreset, SSO_PRESET_INFO, type SsoPreset } from "./sso-presets";

const log = createLogger("sso");

/**
 * Single sign-on, configured in the panel.
 *
 * This used to read four environment variables, which meant changing an IdP
 * required editing a unit file and restarting, and meant exactly one provider
 * forever. Providers are rows now ({@link ssoProviders}); the env vars are
 * seeded into a row once so an existing install keeps working untouched.
 *
 * better-auth constructs its plugin array once, so a provider change cannot
 * take effect by itself — `lib/auth.ts` rebuilds the instance, and
 * `sso-notify.ts` makes the other process in a split rebuild too.
 */

/** Legacy env provider slug; kept as the seeded row's id so links survive. */
export const SSO_PROVIDER_ID = "oidc";

/** One provider, ready to hand to better-auth's generic OAuth plugin. */
export interface SsoProviderConfig {
	ssoProviderId: string;
	providerId: string;
	preset: SsoPreset;
	name: string;
	discoveryUrl: string | null;
	authorizationUrl: string | null;
	tokenUrl: string | null;
	userInfoUrl: string | null;
	clientId: string;
	clientSecret: string;
	scopes: string[];
	allowedEmailDomains: string[];
	defaultOrganizationId: string | null;
	defaultRole: OrgRole;
	groupClaim: string | null;
	groupMappings: Record<string, string>;
	syncRoleOnLogin: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Loading                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cached provider list.
 *
 * Read on every sign-in attempt and on every auth rebuild, and it changes
 * roughly never — but the cache is cleared explicitly on a mutation rather
 * than expired on a timer, because "I saved the provider and it still does not
 * work" for thirty seconds is a support ticket.
 */
let cache: SsoProviderConfig[] | null = null;

export function invalidateSsoProviderCache(): void {
	cache = null;
}

const asRole = (value: string): OrgRole => (value in ORG_ROLE_RANK ? (value as OrgRole) : "member");

/** Every enabled provider, secrets decrypted. Empty when SSO is not set up. */
export async function loadSsoProviders(): Promise<SsoProviderConfig[]> {
	if (cache) return cache;
	try {
		const rows = await db.query.ssoProviders.findMany({
			where: eq(ssoProviders.enabled, true),
		});
		cache = rows.map(toConfig);
		return cache;
	} catch (error) {
		// A provider list that cannot be read must not take the panel down with
		// it: password sign-in still works, and the login page simply offers no
		// SSO button until the database answers again.
		log.error("Could not load SSO providers", {
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}

function toConfig(row: typeof ssoProviders.$inferSelect): SsoProviderConfig {
	const preset: SsoPreset = isSsoPreset(row.preset) ? row.preset : "custom";
	const fixed = SSO_PRESET_INFO[preset].endpoints ?? null;
	return {
		ssoProviderId: row.ssoProviderId,
		providerId: row.providerId,
		preset,
		name: row.name,
		discoveryUrl: row.issuer ? discoveryUrlForIssuer(row.issuer) : null,
		authorizationUrl: row.authorizationUrl ?? fixed?.authorizationUrl ?? null,
		tokenUrl: row.tokenUrl ?? fixed?.tokenUrl ?? null,
		userInfoUrl: row.userInfoUrl ?? fixed?.userInfoUrl ?? null,
		clientId: row.clientId,
		clientSecret: row.clientSecret,
		scopes: row.scopes,
		allowedEmailDomains: row.allowedEmailDomains,
		defaultOrganizationId: row.defaultOrganizationId,
		defaultRole: asRole(row.defaultRole),
		groupClaim: row.groupClaim,
		groupMappings: row.groupMappings,
		syncRoleOnLogin: row.syncRoleOnLogin,
	};
}

/** What the login page renders. Never carries a secret. */
export async function publicSsoProviders(): Promise<
	Array<{ providerId: string; name: string; preset: string }>
> {
	return (await loadSsoProviders()).map((provider) => ({
		providerId: provider.providerId,
		name: provider.name,
		preset: provider.preset,
	}));
}

export async function ssoEnabled(): Promise<boolean> {
	return (await loadSsoProviders()).length > 0;
}

/* -------------------------------------------------------------------------- */
/*  Seeding from the environment                                              */
/* -------------------------------------------------------------------------- */

const env = (key: string): string | null => {
	const value = process.env[key]?.trim();
	return value && value.length > 0 ? value : null;
};

/**
 * Move a pre-0.4 env-configured IdP into a row, once.
 *
 * Runs at boot and does nothing when a row with the same slug already exists,
 * so an operator who later edits the provider in the panel is not overwritten
 * on the next restart by stale environment variables they forgot to remove.
 */
export async function seedSsoProvidersFromEnv(): Promise<boolean> {
	const issuer = env("NIXPLOY_OIDC_ISSUER");
	const clientId = env("NIXPLOY_OIDC_CLIENT_ID");
	const clientSecret = env("NIXPLOY_OIDC_CLIENT_SECRET");
	if (!issuer || !clientId || !clientSecret) return false;

	try {
		const existing = await db.query.ssoProviders.findFirst({
			where: eq(ssoProviders.providerId, SSO_PROVIDER_ID),
		});
		if (existing) return false;

		const slug = env("NIXPLOY_OIDC_DEFAULT_ORG");
		const organization = slug
			? await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })
			: null;
		if (slug && !organization) {
			log.warn(
				`NIXPLOY_OIDC_DEFAULT_ORG "${slug}" does not match an organization — seeding the provider without one`,
			);
		}

		await db.insert(ssoProviders).values({
			providerId: SSO_PROVIDER_ID,
			preset: "custom",
			name: env("NIXPLOY_OIDC_PROVIDER_NAME") ?? "SSO",
			issuer,
			clientId,
			clientSecret,
			defaultOrganizationId: organization?.id ?? null,
		});
		invalidateSsoProviderCache();
		log.info(
			"Imported the NIXPLOY_OIDC_* environment variables into an SSO provider row — edit it in Settings → Platform from now on",
		);
		return true;
	} catch (error) {
		log.error("Could not seed the SSO provider from the environment", {
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

/* -------------------------------------------------------------------------- */
/*  Pure policy                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether an email may sign in through this provider.
 *
 * An empty allow-list means any domain. A non-empty one is matched on the
 * exact domain, case-insensitively — no suffix matching, because
 * `endsWith("example.com")` also admits `notexample.com`.
 */
export function isEmailDomainAllowed(email: string, allowed: readonly string[]): boolean {
	if (allowed.length === 0) return true;
	const at = email.lastIndexOf("@");
	if (at < 0) return false;
	const domain = email.slice(at + 1).toLowerCase();
	return allowed.some((entry) => entry.trim().toLowerCase().replace(/^@/, "") === domain);
}

/** Group names out of a claim that may be a string, a list, or absent. */
export function extractGroups(profile: unknown, claim: string | null): string[] {
	if (!claim || !profile || typeof profile !== "object") return [];
	const value = (profile as Record<string, unknown>)[claim];
	if (typeof value === "string") {
		// Some IdPs emit a space- or comma-separated string rather than a list.
		return value
			.split(/[,\s]+/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	}
	return [];
}

/**
 * The role a set of IdP groups maps to, or null when none of them match.
 *
 * The **highest** mapped role wins: someone in both `ops` and `everyone` gets
 * the more capable of the two, which is what a person adding a group to a user
 * expects. Group names are matched case-insensitively — IdPs disagree about
 * casing, and a mapping that silently never fires is worse than a wrong one.
 */
export function resolveRoleFromGroups(
	groups: readonly string[],
	mappings: Record<string, string>,
): OrgRole | null {
	const lookup = new Map(
		Object.entries(mappings).map(([group, role]) => [group.trim().toLowerCase(), role]),
	);
	let best: OrgRole | null = null;
	for (const group of groups) {
		const mapped = lookup.get(group.trim().toLowerCase());
		if (!mapped || !(mapped in ORG_ROLE_RANK)) continue;
		const role = mapped as OrgRole;
		if (!best || orgRoleRank(role) > orgRoleRank(best)) best = role;
	}
	return best;
}

/**
 * True when the current better-auth request is an SSO sign-in or callback, so
 * `user.create.before` may provision a user even though public registration is
 * otherwise closed.
 */
export function isSsoRequestPath(path: string | null | undefined): boolean {
	if (!path) return false;
	return (
		path.startsWith("/callback/") ||
		path.startsWith("/oauth2/callback") ||
		path === "/sign-in/social" ||
		path.startsWith("/oauth2/sign-in")
	);
}

/* -------------------------------------------------------------------------- */
/*  Provisioning                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Put a freshly provisioned SSO user into the provider's default organization,
 * at the role its group mapping decides (falling back to `defaultRole`).
 *
 * No-op when the provider has no default organization, when the organization
 * has since been deleted, or when the user already belongs to one — an invited
 * user keeps the org they were invited to, which is almost always the intent.
 *
 * @returns the organization joined, or null.
 */
export async function provisionSsoMembership(input: {
	userId: string;
	provider: SsoProviderConfig;
	groups?: readonly string[];
}): Promise<string | null> {
	const { provider } = input;
	if (!provider.defaultOrganizationId) return null;

	const existing = await db.query.members.findFirst({ where: eq(members.userId, input.userId) });
	if (existing) return null;

	const organization = await db.query.organizations.findFirst({
		where: eq(organizations.id, provider.defaultOrganizationId),
	});
	if (!organization) {
		log.warn(
			`SSO provider "${provider.providerId}" points at an organization that no longer exists — user ${input.userId} joined none`,
		);
		return null;
	}

	const role =
		resolveRoleFromGroups(input.groups ?? [], provider.groupMappings) ?? provider.defaultRole;

	await db.insert(members).values({
		id: crypto.randomUUID(),
		organizationId: organization.id,
		userId: input.userId,
		role,
		createdAt: new Date(),
	});
	return organization.id;
}

/**
 * Re-apply a provider's group mapping to an existing member, when the provider
 * asks for it.
 *
 * Deliberately narrow: it only ever moves a member of the provider's **default
 * organization**, it never creates a membership, and it never touches an
 * instance admin's row. Without `syncRoleOnLogin` it does nothing at all —
 * silently overwriting a role an owner set by hand is exactly the surprise
 * that makes people turn SSO off.
 */
export async function syncSsoMemberRole(input: {
	userId: string;
	provider: SsoProviderConfig;
	groups: readonly string[];
}): Promise<OrgRole | null> {
	const { provider } = input;
	if (!provider.syncRoleOnLogin || !provider.defaultOrganizationId) return null;
	const role = resolveRoleFromGroups(input.groups, provider.groupMappings);
	if (!role) return null;

	const membership = await db.query.members.findFirst({
		where: and(
			eq(members.userId, input.userId),
			eq(members.organizationId, provider.defaultOrganizationId),
		),
	});
	if (!membership || membership.role === role) return null;

	await db.update(members).set({ role }).where(eq(members.id, membership.id));
	log.info(
		`SSO group mapping moved user ${input.userId} from ${membership.role} to ${role} in ${provider.defaultOrganizationId}`,
	);
	return role;
}
