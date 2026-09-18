/**
 * Known identity providers, and what each of them needs.
 *
 * A preset is a shortcut, not a lock: everything it fills in stays editable,
 * and `custom` asks for the endpoints directly. The point is that "set up
 * Keycloak" should not begin with reading three vendors' documentation to
 * learn that they all want the same four fields under different names.
 *
 * Import-free on purpose — the panel's provider form renders these labels and
 * hints, so anything pulled in here would land in the browser bundle.
 */

export const SSO_PRESETS = [
	"authentik",
	"keycloak",
	"entra",
	"okta",
	"zitadel",
	"google",
	"github",
	"custom",
] as const;

export type SsoPreset = (typeof SSO_PRESETS)[number];

export interface SsoPresetInfo {
	label: string;
	/**
	 * How this provider is reached. `discovery` derives every endpoint from the
	 * issuer's `.well-known/openid-configuration`; `fixed` has hard-coded
	 * endpoints; `manual` asks the operator for them.
	 */
	kind: "discovery" | "fixed" | "manual";
	/** Shown under the issuer field. */
	issuerHint?: string;
	defaultScopes: string[];
	/** Claim this IdP usually puts group names in, when it has one. */
	defaultGroupClaim?: string;
	/** For `fixed` providers: the endpoints, since there is nothing to discover. */
	endpoints?: { authorizationUrl: string; tokenUrl: string; userInfoUrl: string };
	/** One line of setup advice, rendered next to the form. */
	note?: string;
}

export const SSO_PRESET_INFO: Record<SsoPreset, SsoPresetInfo> = {
	authentik: {
		label: "Authentik",
		kind: "discovery",
		issuerHint: "https://auth.example.com/application/o/<slug>/",
		defaultScopes: ["openid", "profile", "email"],
		defaultGroupClaim: "groups",
		note: "Create an OAuth2/OpenID provider, then an application bound to it. The issuer is the provider's OpenID Configuration Issuer.",
	},
	keycloak: {
		label: "Keycloak",
		kind: "discovery",
		issuerHint: "https://keycloak.example.com/realms/<realm>",
		defaultScopes: ["openid", "profile", "email"],
		defaultGroupClaim: "groups",
		note: "Groups are not in the token by default — add a Group Membership mapper named `groups` to the client scope.",
	},
	entra: {
		label: "Microsoft Entra ID",
		kind: "discovery",
		issuerHint: "https://login.microsoftonline.com/<tenant-id>/v2.0",
		defaultScopes: ["openid", "profile", "email"],
		defaultGroupClaim: "groups",
		note: "Entra emits group object ids, not names, unless the app registration is configured to emit names — map the ids you see.",
	},
	okta: {
		label: "Okta",
		kind: "discovery",
		issuerHint: "https://<org>.okta.com/oauth2/default",
		defaultScopes: ["openid", "profile", "email"],
		defaultGroupClaim: "groups",
		note: "Add a `groups` claim to the ID token in the authorization server's claim settings.",
	},
	zitadel: {
		label: "ZITADEL",
		kind: "discovery",
		issuerHint: "https://<instance>.zitadel.cloud",
		defaultScopes: ["openid", "profile", "email"],
		defaultGroupClaim: "urn:zitadel:iam:org:project:roles",
		note: "Roles arrive under a namespaced claim; enable “Assert Roles On Authentication” on the project.",
	},
	google: {
		label: "Google Workspace",
		kind: "discovery",
		issuerHint: "https://accounts.google.com",
		defaultScopes: ["openid", "profile", "email"],
		note: "Google emits no group claim. Restrict access with the allowed email domains field instead.",
	},
	github: {
		label: "GitHub",
		kind: "fixed",
		defaultScopes: ["read:user", "user:email"],
		endpoints: {
			authorizationUrl: "https://github.com/login/oauth/authorize",
			tokenUrl: "https://github.com/login/oauth/access_token",
			userInfoUrl: "https://api.github.com/user",
		},
		note: "GitHub is OAuth2, not OIDC: there is no discovery document and no group claim. A user's email must be verified on their GitHub account.",
	},
	custom: {
		label: "Custom OpenID Connect",
		kind: "discovery",
		issuerHint: "https://idp.example.com",
		defaultScopes: ["openid", "profile", "email"],
		note: "Any OIDC provider with a discovery document. Leave the issuer empty to enter the endpoints by hand.",
	},
};

const PRESET_SET: ReadonlySet<string> = new Set(SSO_PRESETS);

export const isSsoPreset = (value: unknown): value is SsoPreset =>
	typeof value === "string" && PRESET_SET.has(value);

/** Build the OIDC discovery URL from an issuer, tolerating a trailing slash. */
export function discoveryUrlForIssuer(issuer: string): string {
	return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/**
 * The redirect URI to register at the IdP.
 *
 * `genericOAuth` registers each provider as a *social* provider, so the
 * callback is better-auth's core `/callback/:id` route rather than the
 * plugin's own `/oauth2/callback/:id` — verified against a real Keycloak
 * round trip, which came back to `/api/auth/callback/keycloak`. Getting this
 * wrong costs an operator a redirect-uri mismatch error at the IdP with
 * nothing on our side to explain it.
 *
 * It is also why a provider slug cannot be renamed once it exists.
 */
export const ssoRedirectUri = (baseUrl: string, providerId: string): string =>
	`${baseUrl.replace(/\/+$/, "")}/api/auth/callback/${providerId}`;
