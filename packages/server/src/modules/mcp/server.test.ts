import { describe, expect, it } from "vitest";
import type { TRPCContext } from "../../trpc/init";
import { handleMcpRequest } from "./server";
import { mcpTools } from "./tools";

/**
 * Protocol-level test of the Streamable HTTP adapter: real SDK transport,
 * real JSON-RPC frames, fake authenticated context. `list_templates` never
 * touches the database, so no db mock is needed (db connects lazily).
 */

const fakeCtx = {
	headers: new Headers(),
	session: {
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-1" },
	},
} as unknown as TRPCContext;

const rpc = (method: string, params?: unknown, id = 1) =>
	new Request("http://localhost/api/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});

interface RpcResult {
	result: {
		serverInfo?: { name: string };
		protocolVersion?: string;
		capabilities?: { tools?: unknown };
		tools?: { name: string; description?: string; inputSchema: { type: string } }[];
		isError?: boolean;
		content?: { text: string }[];
	};
}

const parse = async (res: Response): Promise<RpcResult> => (await res.json()) as RpcResult;

describe("handleMcpRequest", () => {
	it("answers initialize with the nixploy server info", async () => {
		const res = await handleMcpRequest(
			rpc("initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "vitest", version: "1.0" },
			}),
			fakeCtx,
		);
		expect(res.status).toBe(200);
		const body = await parse(res);
		expect(body.result.serverInfo?.name).toBe("nixploy");
		expect(body.result.protocolVersion).toBeTruthy();
		expect(body.result.capabilities?.tools).toBeDefined();
	});

	it("lists every registered tool — without a prior initialize (stateless)", async () => {
		const res = await handleMcpRequest(rpc("tools/list"), fakeCtx);
		expect(res.status).toBe(200);
		const body = await parse(res);
		const tools = body.result.tools ?? [];
		const names = tools.map((tool) => tool.name).sort();
		expect(names).toEqual(mcpTools.map((tool) => tool.name).sort());
		for (const tool of tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.inputSchema.type).toBe("object");
		}
	});

	it("calls list_templates and returns compact JSON content", async () => {
		const res = await handleMcpRequest(
			rpc("tools/call", { name: "list_templates", arguments: {} }),
			fakeCtx,
		);
		expect(res.status).toBe(200);
		const body = await parse(res);
		expect(body.result.isError).toBeUndefined();
		const payload = JSON.parse(body.result.content?.[0]?.text ?? "");
		expect(Array.isArray(payload)).toBe(true);
		expect(payload.length).toBeGreaterThan(0);
		expect(payload[0].id ?? payload[0].name).toBeTruthy();
	});

	it("rejects invalid tool arguments as a tool error", async () => {
		const res = await handleMcpRequest(
			rpc("tools/call", { name: "remove_domain", arguments: {} }),
			fakeCtx,
		);
		const body = await parse(res);
		// Zod rejection surfaces as isError content, not an HTTP error.
		expect(body.result.isError).toBe(true);
	});
});
