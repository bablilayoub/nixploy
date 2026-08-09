import { TRPCError } from "@trpc/server";
import { client } from "../db";
import type { TRPCContext } from "../trpc/init";
import { clientIpFromRequest, takeRateLimitToken } from "../utils/rate-limit";
import { auth } from "./auth";

export interface ApiKeyContextOptions {
	/**
	 * Rate-limit bucket prefix (e.g. "rest-api-key", "mcp-api-key"). Two
	 * buckets are consumed per request: `<bucket>:<ip>` (120/min) and
	 * `<bucket>-auth:<ip>` (30/min).
	 */
	bucket: string;
	/** Also accept `Authorization: Bearer <key>` next to `x-api-key`. */
	allowBearer?: boolean;
}

/**
 * Authenticate an API-key request (REST adapter, MCP endpoint) and build the
 * same tRPC context shape better-auth's getSession produces — the routers
 * only read `user.id` and `session.activeOrganizationId`.
 *
 * Org resolution: an explicit `x-organization-id` header wins (membership is
 * verified); otherwise the caller's first membership is used.
 */
export async function buildApiKeyContext(
	req: Request,
	options: ApiKeyContextOptions,
): Promise<TRPCContext> {
	const ip = clientIpFromRequest(req);
	if (
		!takeRateLimitToken(`${options.bucket}:${ip}`, { windowMs: 60_000, max: 120 }) ||
		!takeRateLimitToken(`${options.bucket}-auth:${ip}`, { windowMs: 60_000, max: 30 })
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
		key: { referenceId?: string; userId?: string; id: string } | null;
	};
	if (!result.valid || !result.key) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Invalid or expired API key",
		});
	}

	// @better-auth/api-key >= 1.6 exposes the owner as referenceId.
	const userId = result.key.referenceId ?? result.key.userId;
	if (!userId) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Unknown API key owner" });
	}
	const users = await client`
		SELECT id, name, email, email_verified AS "emailVerified",
			image, role, banned, two_factor_enabled AS "twoFactorEnabled",
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

	// Prefer explicit org from the client (multi-org API keys); otherwise first membership.
	const requestedOrgId = req.headers.get("x-organization-id")?.trim() || null;
	let activeOrganizationId: string | null = null;
	if (requestedOrgId) {
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
			FROM member WHERE user_id = ${userId} LIMIT 1
		`;
		activeOrganizationId =
			(memberships[0] as { organizationId?: string } | undefined)?.organizationId ?? null;
	}

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

	return { headers: req.headers, session };
}
