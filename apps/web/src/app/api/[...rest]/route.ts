import { buildApiKeyContext } from "@nixploy/server/lib/api-key-context";
import { appRouter } from "@nixploy/server/trpc";
import type { TRPCContext } from "@nixploy/server/trpc/init";
import { coerceQueryInput } from "@nixploy/server/trpc/query-input";
import { getTRPCErrorFromUnknown } from "@trpc/server";
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
	/** Raw Zod input schema (first tRPC input parser), when the procedure declares one. */
	inputSchema: unknown;
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
	const def = (node as { _def?: { type?: string; inputs?: unknown[] } })._def;
	if (def?.type !== "query" && def?.type !== "mutation") return null;

	return {
		type: def.type,
		inputSchema: def.inputs?.[0],
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

async function buildContext(req: Request): Promise<TRPCContext> {
	// Shared with the MCP endpoint — see packages/server/src/lib/api-key-context.ts.
	return buildApiKeyContext(req, { bucket: "rest-api-key" });
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

	if (req.method === "POST") {
		const contentLength = Number(req.headers.get("content-length") ?? "0");
		if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
			return errorResponse("PAYLOAD_TOO_LARGE", "Payload too large");
		}
	}

	let ctx: TRPCContext;
	try {
		ctx = await buildContext(req);
	} catch (error) {
		const trpcError = getTRPCErrorFromUnknown(error);
		return errorResponse(trpcError.code, trpcError.message);
	}

	let input: unknown;
	try {
		if (req.method === "GET") {
			const url = new URL(req.url);
			const rawInput = url.searchParams.get("input");
			if (rawInput !== null) {
				input = decodeSerialized(rawInput);
			} else {
				// Flattened params arrive as strings; numbers/booleans are coerced
				// only where the procedure's Zod schema expects them (a `z.string()`
				// field such as `?search=2024` must stay a string).
				const params: Record<string, string> = {};
				for (const [key, value] of url.searchParams.entries()) {
					params[key] = value;
				}
				input =
					Object.keys(params).length > 0
						? coerceQueryInput(params, procedure.inputSchema)
						: undefined;
			}
		} else {
			const text = await req.text();
			if (text.length > 1_048_576) {
				return errorResponse("PAYLOAD_TOO_LARGE", "Payload too large");
			}
			input = text.length > 0 ? decodeSerialized(text) : undefined;
		}
	} catch {
		return errorResponse("PARSE_ERROR", "Failed to parse request input");
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
