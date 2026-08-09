import { buildApiKeyContext } from "@nixploy/server/lib/api-key-context";
import { handleMcpRequest } from "@nixploy/server/modules/mcp/server";
import { getTRPCErrorFromUnknown } from "@trpc/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP (Model Context Protocol) endpoint — Streamable HTTP transport.
 *
 *   POST /api/mcp   JSON-RPC messages (initialize, tools/list, tools/call)
 *
 * Auth: `Authorization: Bearer <api-key>` or `x-api-key` header, verified
 * through the same shared helper as the REST adapter (same rate limits,
 * org resolution and ban checks). Optional `x-organization-id` selects the
 * organization for multi-org keys. Tool handlers live in
 * @nixploy/server/src/modules/mcp and dispatch into the tRPC routers.
 */

const HTTP_STATUS_BY_CODE: Record<string, number> = {
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	TOO_MANY_REQUESTS: 429,
};

async function handler(req: Request): Promise<Response> {
	try {
		const ctx = await buildApiKeyContext(req, { bucket: "mcp-api-key", allowBearer: true });
		return await handleMcpRequest(req, ctx);
	} catch (error) {
		const trpcError = getTRPCErrorFromUnknown(error);
		return Response.json(
			{ message: trpcError.message },
			{ status: HTTP_STATUS_BY_CODE[trpcError.code] ?? 500 },
		);
	}
}

export { handler as DELETE, handler as GET, handler as POST };
