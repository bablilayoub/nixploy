import { relations } from "drizzle-orm";
import { boolean, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { encryptedText } from "../custom-columns";
import { organizations } from "./auth";
import { createdAt, idColumn, updatedAt } from "./utils";

/**
 * Single sign-on providers, configured in the panel.
 *
 * SSO used to be four environment variables, which meant an operator had to
 * edit a systemd unit or a compose file and restart to change an IdP — and
 * meant exactly one provider, forever. These rows replace them; the env vars
 * are seeded into a row once on first boot so an existing install keeps
 * working without anyone doing anything.
 *
 * Instance-level, not per-organization: the login page is instance-wide, and a
 * provider decides which organization its users land in through
 * `defaultOrganizationId`.
 */
export const ssoProviders = pgTable("sso_provider", {
	ssoProviderId: idColumn("sso_provider_id"),
	/**
	 * Stable slug. It is the better-auth `providerId`, so it appears in the
	 * redirect URI registered at the IdP — renaming one breaks every existing
	 * link, which is why the router refuses to change it after creation.
	 */
	providerId: text("provider_id").notNull().unique(),
	/** authentik | keycloak | entra | okta | zitadel | google | github | custom */
	preset: text("preset").notNull().default("custom"),
	/** Label on the "Continue with …" button. */
	name: text("name").notNull(),
	/** OIDC issuer; discovery is derived from it. Null for a manual endpoint set. */
	issuer: text("issuer"),
	/** Explicit endpoints, for an IdP that publishes no discovery document. */
	authorizationUrl: text("authorization_url"),
	tokenUrl: text("token_url"),
	userInfoUrl: text("user_info_url"),
	clientId: text("client_id").notNull(),
	clientSecret: encryptedText("client_secret").notNull(),
	scopes: jsonb("scopes").$type<string[]>().notNull().default(["openid", "profile", "email"]),
	/**
	 * Only these email domains may sign in through this provider; empty means
	 * any. An IdP that federates several tenants will happily authenticate a
	 * user from a domain nobody intended to admit, and the provider — not the
	 * user record — is where that belongs.
	 */
	allowedEmailDomains: jsonb("allowed_email_domains").$type<string[]>().notNull().default([]),
	/** Organization a user provisioned through this provider joins. */
	defaultOrganizationId: text("default_organization_id").references(() => organizations.id, {
		onDelete: "set null",
	}),
	/** Role they join with (`viewer` … `owner`), before any group mapping. */
	defaultRole: text("default_role").notNull().default("member"),
	/** Claim in the ID token / userinfo carrying group names, e.g. `groups`. */
	groupClaim: text("group_claim"),
	/** `{ "<group from the IdP>": "<nixploy role>" }`; highest rank wins. */
	groupMappings: jsonb("group_mappings").$type<Record<string, string>>().notNull().default({}),
	/**
	 * Re-apply the group mapping on every sign-in, so removing someone from a
	 * group in the IdP demotes them here. Off by default: it silently overrides
	 * a role an owner set by hand in the panel.
	 */
	syncRoleOnLogin: boolean("sync_role_on_login").notNull().default(false),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const ssoProvidersRelations = relations(ssoProviders, ({ one }) => ({
	defaultOrganization: one(organizations, {
		fields: [ssoProviders.defaultOrganizationId],
		references: [organizations.id],
	}),
}));
