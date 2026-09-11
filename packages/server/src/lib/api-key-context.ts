import { TRPCError } from "@trpc/server";
import { client } from "../db";
import {
	type ApiKeyScope,
	apiKeyScopeCapabilities,
	describeApiKey,
} from "../modules/auth/api-key-scopes";
import type { CapabilityScope, OrgCapability } from "../modules/projects/capabilities";
import { ORG_CAPABILITIES } from "../modules/projects/capabilities";
import type { TRPCContext } from "../trpc/init";
import {
	clientIpFromRequest,
	hasRateLimitCapacity,
	ipRateLimitMax,
	takeIpRateLimitToken,
	takeRateLimitToken,
} from "../utils/rate-limit";
import { auth } from "./auth";

export interface ApiKeyContextOptions {
	/**
	 * Rate-limit bucket prefix (e.g. "rest-api-key", "mcp-api-key"). Three
	 * buckets guard a request: `<bucket>:<ip>` (120/min flood guard, widened
	 * when the IP is unknown), `<bucket>-auth:<ip>` (30 failed key
	 * verifications/min) and, once authenticated, `<bucket>:key:<id>`
	 * (120/min per API key) — so one abusive caller cannot 429 every other
	 * key of the instance behind a proxy that hides client IPs.
	 */
	bucket: string;
	/** Also accept `Authorization: Bearer <key>` next to `x-api-key`. */
	allowBearer?: boolean;
}

/** Expand a scope into concrete capabilities; no scope (bound legacy key) = all. */
function scopeCeiling(scope: ApiKeyScope | null): readonly OrgCapability[] {
	if (!scope) return ORG_CAPABILITIES as OrgCapability[];
	const ceiling = apiKeyScopeCapabilities(scope);
	return ceiling === "all" ? (ORG_CAPABILITIES as OrgCapability[]) : ceiling;
}

const REQUESTS_PER_IP_MINUTE = 120;
const REQUESTS_PER_KEY_MINUTE = 120;
const AUTH_FAILURES_PER_MINUTE = 30;

/** What the verified key turned out to be, for callers that need to branch. */
export interface ApiKeyCallerInfo {
	id: string;
	scope: ApiKeyScope | null;
	/** Organization the key is bound to (`metadata.organizationId`). */
	organizationId: string | null;
	/** Pre-scopes key: full owner capabilities, org from header/oldest membership. */
	legacy: boolean;
}

export interface ApiKeyContext extends TRPCContext {
	apiKey: ApiKeyCallerInfo;
	/**
	 * Capability ceiling for this request. `protectedProcedure` enters it
	 * around every procedure (`trpc/init.ts`); non-tRPC callers must wrap
	 * their own work with `runWithCapabilityScope`.
	 */
	capabilityScope?: CapabilityScope;
}

/**
 * Authenticate an API-key request (REST adapter, MCP endpoint, deploy webhook)
 * and build the same tRPC context shape better-auth's getSession produces —
 * the routers only read `user.id` and `session.activeOrganizationId`.
 *
 * Org resolution: a key bound to an organization (`metadata.organizationId`)
 * always acts for that org; otherwise an explicit `x-organization-id` header
 * wins (membership is verified) and finally the caller's oldest membership.
 *
 * Scopes: `permissions.nixploy = ["read" | "deploy" | "write" | "admin"]` is
 * installed as a per-request capability ceiling (see
 * `modules/projects/capabilities.ts`), so `assertCapability` in every router
 * sees the reduced set without any router change.
 */
export async function buildApiKeyContext(
	req: Request,
	options: ApiKeyContextOptions,
): Promise<ApiKeyContext> {
	const ip = clientIpFromRequest(req);
	const authFailureKey = `${options.bucket}-auth:${ip}`;
	const authFailureMax = ipRateLimitMax(ip, AUTH_FAILURES_PER_MINUTE);
	if (
		!takeIpRateLimitToken(options.bucket, ip, { windowMs: 60_000, max: REQUESTS_PER_IP_MINUTE }) ||
		!hasRateLimitCapacity(authFailureKey, authFailureMax)
	) {
		throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests" });
	}

	const bearer = options.allowBearer
		? req.headers
				.get("authorization")
				?.match(/^Bearer\s+(.+)$/i)?.[1]
				?.trim()
		: undefined;
	const apiKeyHeader = req.headers.get("x-api-key") || bearer;
	if (!apiKeyHeader) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: options.allowBearer
				? "Missing API key (Authorization: Bearer or x-api-key header)"
				: "Missing x-api-key header",
		});
	}

	const result = (await auth.api.verifyApiKey({
		body: { key: apiKeyHeader },
	})) as {
		valid: boolean;
		key: {
			referenceId?: string;
			userId?: string;
			id: string;
			permissions?: unknown;
			metadata?: unknown;
		} | null;
	};
	if (!result.valid || !result.key) {
		// Only failed verifications count against the per-IP auth bucket, so
		// legitimate keys behind a shared/unknown IP are never starved by it.
		takeRateLimitToken(authFailureKey, { windowMs: 60_000, max: authFailureMax });
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Invalid or expired API key",
		});
	}
	if (
		!takeRateLimitToken(`${options.bucket}:key:${result.key.id}`, {
			windowMs: 60_000,
			max: REQUESTS_PER_KEY_MINUTE,
		})
	) {
		throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests" });
	}

	// @better-auth/api-key >= 1.6 exposes the owner as referenceId.
	const userId = result.key.referenceId ?? result.key.userId;
	if (!userId) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Unknown API key owner" });
	}
	const users = await client`
		SELECT id, name, email, email_verified AS "emailVerified",
			image, role, banned, ban_expires AS "banExpires",
			two_factor_enabled AS "twoFactorEnabled",
			created_at AS "createdAt", updated_at AS "updatedAt"
		FROM "user" WHERE id = ${userId} LIMIT 1
	`;
	const user = users[0];
	if (!user) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Unknown API key owner" });
	}
	const banned =
		(user as { banned?: boolean | null; banExpires?: Date | null }).banned === true &&
		(!(user as { banExpires?: Date | null }).banExpires ||
			((user as { banExpires?: Date | null }).banExpires?.getTime() ?? 0) > Date.now());
	if (banned) {
		throw new TRPCError({ code: "FORBIDDEN", message: "User is banned" });
	}

	// Scope + org binding (modules/auth/api-key-scopes.ts). Keys created before
	// scopes existed carry neither column and keep the old behaviour.
	const { scope, organizationId: boundOrganizationId } = describeApiKey(result.key);

	// Prefer explicit org from the client (multi-org API keys); otherwise the
	// oldest membership — the same default sessions get (lib/auth.ts). A key
	// bound to one organization ignores neither: it refuses any other org.
	const requestedOrgId = req.headers.get("x-organization-id")?.trim() || null;
	if (boundOrganizationId && requestedOrgId && requestedOrgId !== boundOrganizationId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "This API key is bound to a different organization",
		});
	}
	let activeOrganizationId: string | null = null;
	if (boundOrganizationId) {
		// The binding is only as good as the owner's membership: a key stays
		// valid exactly as long as its owner belongs to the bound org.
		const membership = await client`
			SELECT organization_id AS "organizationId"
			FROM member
			WHERE user_id = ${userId} AND organization_id = ${boundOrganizationId}
			LIMIT 1
		`;
		if (!membership[0]) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Not a member of the organization this API key is bound to",
			});
		}
		activeOrganizationId = boundOrganizationId;
	} else if (requestedOrgId) {
		const membership = await client`
			SELECT organization_id AS "organizationId"
			FROM member
			WHERE user_id = ${userId} AND organization_id = ${requestedOrgId}
			LIMIT 1
		`;
		if (!membership[0]) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Not a member of the requested organization",
			});
		}
		activeOrganizationId = requestedOrgId;
	} else {
		const memberships = await client`
			SELECT organization_id AS "organizationId"
			FROM member WHERE user_id = ${userId}
			ORDER BY created_at ASC LIMIT 1
		`;
		activeOrganizationId =
			(memberships[0] as { organizationId?: string } | undefined)?.organizationId ?? null;
	}

	// What this caller may do for the rest of the request: the scope's
	// capability ceiling (intersected with the owner's own set downstream) plus
	// the org binding. Legacy keys (no scope, no binding) carry no scope and
	// keep the owner's full set, as before.
	const capabilityScope: CapabilityScope | undefined =
		scope || boundOrganizationId
			? {
					allowed: new Set<OrgCapability>(scopeCeiling(scope)),
					organizationId: boundOrganizationId,
					label: scope ? `API key scope (${scope})` : "API key organization binding",
				}
			: undefined;

	// Synthesize the same { user, session } shape better-auth's getSession
	// returns — the routers only read user.id and session.activeOrganizationId.
	const now = new Date();
	const session = {
		user,
		session: {
			id: `api-key_${result.key.id}`,
			token: "api-key",
			userId,
			expiresAt: new Date(now.getTime() + 1000 * 60 * 60),
			createdAt: now,
			updatedAt: now,
			ipAddress: null,
			userAgent: req.headers.get("user-agent"),
			impersonatedBy: null,
			activeOrganizationId,
		},
	} as unknown as NonNullable<TRPCContext["session"]>;

	return {
		headers: req.headers,
		session,
		capabilityScope,
		apiKey: {
			id: result.key.id,
			scope,
			organizationId: boundOrganizationId,
			legacy: scope === null && boundOrganizationId === null,
		},
	};
}
