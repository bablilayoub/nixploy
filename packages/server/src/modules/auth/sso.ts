import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { members, organizations } from "../../db/schema";

/**
 * Optional OIDC single sign-on through better-auth's `genericOAuth` plugin.
 *
 * Configured entirely from the environment so a self-hosted instance can turn
 * it on without a migration:
 *
 * ```
 * NIXPLOY_OIDC_ISSUER=https://auth.example.com/application/o/nixploy/
 * NIXPLOY_OIDC_CLIENT_ID=...
 * NIXPLOY_OIDC_CLIENT_SECRET=...
 * NIXPLOY_OIDC_PROVIDER_NAME="Authentik"     # button label, optional
 * NIXPLOY_OIDC_DEFAULT_ORG=acme-ops          # org slug new users JIT-join
 * ```
 *
 * In better-auth 1.7 `genericOAuth` registers the provider as a first-class
 * social provider, so the client signs in through `/api/auth/sign-in/social`
 * with `provider: <providerId>` and the callback is the core `/callback/:id`
 * route — no client plugin is needed.
 */

export const SSO_PROVIDER_ID = "oidc";

export interface SsoConfig {
	providerId: string;
	/** Label for the "Continue with …" button. */
	name: string;
	issuer: string;
	discoveryUrl: string;
	clientId: string;
	clientSecret: string;
	/** Slug of the organization new SSO users join as `member`. */
	defaultOrganizationSlug: string | null;
}

const env = (key: string): string | null => {
	const value = process.env[key]?.trim();
	return value && value.length > 0 ? value : null;
};

/** Build the OIDC discovery URL from an issuer, tolerating a trailing slash. */
export function discoveryUrlForIssuer(issuer: string): string {
	return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/** Parsed SSO configuration, or `null` when the instance has no IdP configured. */
export function ssoConfig(): SsoConfig | null {
	const issuer = env("NIXPLOY_OIDC_ISSUER");
	const clientId = env("NIXPLOY_OIDC_CLIENT_ID");
	const clientSecret = env("NIXPLOY_OIDC_CLIENT_SECRET");
	if (!issuer || !clientId || !clientSecret) return null;
	return {
		providerId: SSO_PROVIDER_ID,
		name: env("NIXPLOY_OIDC_PROVIDER_NAME") ?? "SSO",
		issuer,
		discoveryUrl: discoveryUrlForIssuer(issuer),
		clientId,
		clientSecret,
		defaultOrganizationSlug: env("NIXPLOY_OIDC_DEFAULT_ORG"),
	};
}

export function ssoEnabled(): boolean {
	return ssoConfig() !== null;
}

/**
 * What the login page needs to render the button. Never includes the client
 * secret; exposed through the public `setup.authConfig` procedure so no
 * `NEXT_PUBLIC_*` URL is baked into the client bundle.
 */
export function publicSsoInfo(): { enabled: boolean; providerId: string; name: string } {
	const config = ssoConfig();
	if (!config) return { enabled: false, providerId: SSO_PROVIDER_ID, name: "SSO" };
	return { enabled: true, providerId: config.providerId, name: config.name };
}

/**
 * True when the current better-auth request is an SSO sign-in/callback, so
 * `user.create.before` may provision a user even though public registration
 * is otherwise closed.
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

/**
 * JIT membership: put a freshly provisioned SSO user into the organization
 * named by `NIXPLOY_OIDC_DEFAULT_ORG` (slug) as `member`. No-op when SSO is
 * off, no default org is configured, the slug does not exist, or the user
 * already belongs to any organization (an invited user keeps their org).
 *
 * @returns the organization id joined, or null.
 */
export async function joinDefaultOrganizationForSso(userId: string): Promise<string | null> {
	const config = ssoConfig();
	if (!config?.defaultOrganizationSlug) return null;

	const existing = await db.query.members.findFirst({ where: eq(members.userId, userId) });
	if (existing) return null;

	const organization = await db.query.organizations.findFirst({
		where: eq(organizations.slug, config.defaultOrganizationSlug),
	});
	if (!organization) {
		console.warn(
			`SSO default organization "${config.defaultOrganizationSlug}" does not exist — user ${userId} joined no organization`,
		);
		return null;
	}

	const alreadyMember = await db.query.members.findFirst({
		where: and(eq(members.userId, userId), eq(members.organizationId, organization.id)),
	});
	if (alreadyMember) return organization.id;

	await db.insert(members).values({
		id: crypto.randomUUID(),
		organizationId: organization.id,
		userId,
		role: "member",
		createdAt: new Date(),
	});
	return organization.id;
}
