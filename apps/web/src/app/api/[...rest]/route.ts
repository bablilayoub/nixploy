import { client } from "@nixploy/server";
import { auth } from "@nixploy/server/auth";
import { appRouter } from "@nixploy/server/trpc";
import type { TRPCContext } from "@nixploy/server/trpc/init";
import { getTRPCErrorFromUnknown, TRPCError } from "@trpc/server";
import superjson, { type SuperJSONResult } from "superjson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REST adapter over the tRPC appRouter, consumed by @nixploy/cli and API-key
 * users. Convention (mirrors apps/cli/src/client.ts):
 *
 *   GET  /api/<router>.<procedure>?<flattened input params>
 *        (or ?input=<URL-encoded JSON / superjson> for complex payloads)
 *   POST /api/<router>.<procedure>   body = raw JSON input
 *
 * Auth: `x-api-key` header, verified through the better-auth api-key plugin.
 * Responses use the tRPC envelope `{ result: { data } }`; errors carry a
 * top-level `message` plus a tRPC-ish `error` object.
 */

const HTTP_STATUS_BY_CODE: Record<string, number> = {
	PARSE_ERROR: 400,
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	METHOD_NOT_SUPPORTED: 405,
	TIMEOUT: 408,
	CONFLICT: 409,
	PRECONDITION_FAILED: 412,
	PAYLOAD_TOO_LARGE: 413,
	UNPROCESSABLE_CONTENT: 422,
	TOO_MANY_REQUESTS: 429,
	INTERNAL_SERVER_ERROR: 500,
	NOT_IMPLEMENTED: 501,
};

const NUMERIC_CODE: Record<string, number> = {
	PARSE_ERROR: -32700,
	BAD_REQUEST: -32600,
	INTERNAL_SERVER_ERROR: -32603,
	NOT_IMPLEMENTED: -32603,
	UNAUTHORIZED: -32001,
	FORBIDDEN: -32003,
	NOT_FOUND: -32004,
	METHOD_NOT_SUPPORTED: -32005,
	TIMEOUT: -32008,
	CONFLICT: -32009,
	PRECONDITION_FAILED: -32012,
	PAYLOAD_TOO_LARGE: -32013,
	UNPROCESSABLE_CONTENT: -32022,
	TOO_MANY_REQUESTS: -32029,
};

function errorResponse(code: string, message: string) {
	const httpStatus = HTTP_STATUS_BY_CODE[code] ?? 500;
	return Response.json(
		{
			message,
			error: {
				message,
				code: NUMERIC_CODE[code] ?? -32603,
				data: { code, httpStatus },
			},
		},
		{ status: httpStatus },
	);
}

interface ResolvedProcedure {
	type: "query" | "mutation";
	call: (ctx: TRPCContext, input: unknown) => Promise<unknown>;
}

function resolveProcedure(path: string): ResolvedProcedure | null {
	const dotIndex = path.indexOf(".");
	if (dotIndex <= 0 || dotIndex === path.length - 1) return null;

	let node: unknown = appRouter;
	for (const segment of path.split(".")) {
		node = (node as Record<string, unknown>)?.[segment];
		if (node === undefined || node === null) return null;
	}
	const def = (node as { _def?: { type?: string } })._def;
	if (def?.type !== "query" && def?.type !== "mutation") return null;

	return {
		type: def.type,
		call: async (ctx, input) => {
			const caller = appRouter.createCaller(ctx) as unknown as Record<
				string,
				Record<string, (input: unknown) => Promise<unknown>>
			>;
			const routerName = path.slice(0, dotIndex);
			const procedureName = path.slice(dotIndex + 1);
			return caller[routerName]?.[procedureName]?.(input);
		},
	};
}

/** Decode a JSON or superjson-serialized value. */
function decodeSerialized(raw: string): unknown {
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed === "object" && parsed !== null && "json" in parsed && "meta" in parsed) {
		return superjson.deserialize(parsed as SuperJSONResult);
	}
	return parsed;
}

/**
 * Flattened GET query params arrive as strings. Coerce obvious booleans and
 * numbers so Zod schemas (e.g. `z.boolean()`, `z.number()`) accept CLI input.
 * UUID-like and non-numeric strings stay strings.
 */
function coerceFlattenedParams(params: Record<string, string>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if (value === "true") {
			out[key] = true;
		} else if (value === "false") {
			out[key] = false;
		} else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
			out[key] = Number(value);
		} else {
			out[key] = value;
		}
	}
	return out;
}

async function buildContext(req: Request): Promise<TRPCContext> {
	const apiKeyHeader = req.headers.get("x-api-key");
	if (!apiKeyHeader) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Missing x-api-key header",
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

async function handle(req: Request, path: string): Promise<Response> {
	const procedure = resolveProcedure(path);
	if (!procedure) {
		return errorResponse("NOT_FOUND", `Unknown procedure "${path}"`);
	}

	const expectedMethod = procedure.type === "query" ? "GET" : "POST";
	if (req.method !== expectedMethod) {
		return errorResponse("METHOD_NOT_SUPPORTED", `${procedure.type}s must use ${expectedMethod}`);
	}

	let input: unknown;
	try {
		if (req.method === "GET") {
			const url = new URL(req.url);
			const rawInput = url.searchParams.get("input");
			if (rawInput !== null) {
				input = decodeSerialized(rawInput);
			} else {
				const params: Record<string, string> = {};
				for (const [key, value] of url.searchParams.entries()) {
					params[key] = value;
				}
				input = Object.keys(params).length > 0 ? coerceFlattenedParams(params) : undefined;
			}
		} else {
			const text = await req.text();
			input = text.length > 0 ? decodeSerialized(text) : undefined;
		}
	} catch {
		return errorResponse("PARSE_ERROR", "Failed to parse request input");
	}

	let ctx: TRPCContext;
	try {
		ctx = await buildContext(req);
	} catch (error) {
		const trpcError = getTRPCErrorFromUnknown(error);
		return errorResponse(trpcError.code, trpcError.message);
	}

	try {
		const data = await procedure.call(ctx, input);
		return Response.json({ result: { data } });
	} catch (error) {
		const trpcError = getTRPCErrorFromUnknown(error);
		return errorResponse(trpcError.code, trpcError.message);
	}
}

interface RouteParams {
	params: Promise<{ rest: string[] }>;
}

async function handler(req: Request, { params }: RouteParams) {
	const { rest } = await params;
	return handle(req, rest.join("/"));
}

export { handler as GET, handler as POST };
