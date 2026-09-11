// Type-only: this module is imported by the API-keys settings card, so it must
// stay free of runtime imports that reach drizzle / node builtins.
import type { OrgCapability } from "../projects/capabilities";

/**
 * API-key scopes.
 *
 * A key is *not* the owner's full identity any more: `apikey.permissions`
 * (better-auth shape `{ [resource]: string[] }`) carries one Nixploy scope and
 * `apikey.metadata.organizationId` binds the key to a single organization.
 * `buildApiKeyContext` (`lib/api-key-context.ts`) turns both into a per-request
 * capability overlay that `assertCapability` sees.
 *
 * Keys created before scopes existed carry neither column; they keep the old
 * behaviour (owner's full capability set, org from `x-organization-id` or the
 * oldest membership) and are flagged "legacy" in the UI.
 */

/** Ordered weakest → strongest; the order is the rank used by {@link parseApiKeyScope}. */
export const API_KEY_SCOPES = ["read", "deploy", "write", "admin"] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Resource key inside better-auth's `permissions` record. */
export const API_KEY_PERMISSION_RESOURCE = "nixploy";

/** Metadata key holding the organization a key is bound to. */
export const API_KEY_ORGANIZATION_METADATA_KEY = "organizationId";

/**
 * Metadata key holding the scope.
 *
 * `permissions` is the canonical column, but the api-key plugin treats it as a
 * **server-only** property: `/api-key/create` rejects it outright when the
 * request carries headers (i.e. every call from the panel). So the panel sends
 * the scope in `metadata`, and `lib/auth.ts` mirrors it into `permissions`
 * right after creation. Both are read back here.
 */
export const API_KEY_SCOPE_METADATA_KEY = "scope";

/**
 * Read-only capabilities. Procedures that only list or fetch rows carry no
 * capability check at all, so a `read` key reaches every `*.all` / `*.one`
 * query of its organization — these two are the capabilities such a key still
 * needs to see audit rows and unmasked secrets.
 */
const READ_CAPABILITIES = ["audit.read", "secrets.read"] as const;

/** Added on top of `read` by the `deploy` scope. */
const DEPLOY_CAPABILITIES = ["service.deploy", "service.runtime"] as const;

/** Added on top of `deploy` by the `write` scope. */
const WRITE_CAPABILITIES = ["service.write", "domains.manage", "secrets.write"] as const;

/**
 * Capability ceiling each scope grants, intersected with the owner's own set.
 * `"all"` means "no reduction" — an admin key is exactly as powerful as its
 * owner. Callers expand the sentinel (`lib/api-key-context.ts`).
 */
export type ScopeCeiling = readonly OrgCapability[] | "all";

export const API_KEY_SCOPE_CAPABILITIES: Record<ApiKeyScope, ScopeCeiling> = {
	read: READ_CAPABILITIES,
	deploy: [...READ_CAPABILITIES, ...DEPLOY_CAPABILITIES],
	write: [...READ_CAPABILITIES, ...DEPLOY_CAPABILITIES, ...WRITE_CAPABILITIES],
	admin: "all",
};

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
	read: "Read only",
	deploy: "Deploy",
	write: "Write",
	admin: "Full access",
};

export const API_KEY_SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
	read: "List and inspect projects, services, deployments, logs and audit rows.",
	deploy: "Everything in read, plus deploy, redeploy, start and stop services.",
	write: "Everything in deploy, plus edit service settings, domains and secrets.",
	admin: "The owner's full capability set in the bound organization.",
};

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
	return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** Position in {@link API_KEY_SCOPES}; -1 for anything unknown. */
export function apiKeyScopeRank(scope: string): number {
	return (API_KEY_SCOPES as readonly string[]).indexOf(scope);
}

/**
 * Read the Nixploy scope out of a better-auth `permissions` record.
 * Returns `null` for keys that carry no recognisable scope (legacy keys).
 * When several scopes are listed the strongest wins.
 */
export function parseApiKeyScope(permissions: unknown): ApiKeyScope | null {
	if (!permissions || typeof permissions !== "object") return null;
	const raw = (permissions as Record<string, unknown>)[API_KEY_PERMISSION_RESOURCE];
	if (!Array.isArray(raw)) return null;
	let best: ApiKeyScope | null = null;
	for (const entry of raw) {
		if (!isApiKeyScope(entry)) continue;
		if (!best || apiKeyScopeRank(entry) > apiKeyScopeRank(best)) best = entry;
	}
	return best;
}

/** Permissions payload for the canonical column (written server-side only). */
export function buildApiKeyPermissions(scope: ApiKeyScope): Record<string, string[]> {
	return { [API_KEY_PERMISSION_RESOURCE]: [scope] };
}

/** Scope recorded in `apikey.metadata` (the channel the panel may write). */
export function apiKeyMetadataScope(metadata: unknown): ApiKeyScope | null {
	if (!metadata || typeof metadata !== "object") return null;
	const value = (metadata as Record<string, unknown>)[API_KEY_SCOPE_METADATA_KEY];
	return isApiKeyScope(value) ? value : null;
}

/** Capabilities a scope allows, or `"all"` for the unreduced owner set. */
export function apiKeyScopeCapabilities(scope: ApiKeyScope): ScopeCeiling {
	return API_KEY_SCOPE_CAPABILITIES[scope];
}

/**
 * Organization a key is bound to, from `apikey.metadata`. `null` means an
 * unbound (legacy) key: org resolution falls back to `x-organization-id` or
 * the owner's oldest membership.
 */
export function apiKeyOrganizationId(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") return null;
	const value = (metadata as Record<string, unknown>)[API_KEY_ORGANIZATION_METADATA_KEY];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Metadata payload to send with `authClient.apiKey.create`. */
export function buildApiKeyMetadata(
	organizationId: string | null,
	scope: ApiKeyScope,
): Record<string, string> {
	return {
		...(organizationId ? { [API_KEY_ORGANIZATION_METADATA_KEY]: organizationId } : {}),
		[API_KEY_SCOPE_METADATA_KEY]: scope,
	};
}

export interface ApiKeyScopeInfo {
	scope: ApiKeyScope | null;
	organizationId: string | null;
	/** No scope and no org binding — behaves like a pre-scopes key. */
	legacy: boolean;
}

/**
 * Scope + org binding of one key row. `permissions` wins; `metadata.scope` is
 * the fallback for the window between creation and the mirror write, and for
 * keys created by a client that only had the metadata channel.
 */
export function describeApiKey(input: {
	permissions?: unknown;
	metadata?: unknown;
}): ApiKeyScopeInfo {
	const scope = parseApiKeyScope(input.permissions) ?? apiKeyMetadataScope(input.metadata);
	const organizationId = apiKeyOrganizationId(input.metadata);
	return { scope, organizationId, legacy: scope === null && organizationId === null };
}
