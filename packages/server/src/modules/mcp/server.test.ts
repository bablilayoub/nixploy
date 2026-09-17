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
		capabilities?: { tools?: unknown; prompts?: unknown; resources?: unknown };
		tools?: {
			name: string;
			description?: string;
			inputSchema: { type: string };
			annotations?: {
				title?: string;
				readOnlyHint?: boolean;
				destructiveHint?: boolean;
				idempotentHint?: boolean;
			};
		}[];
		prompts?: { name: string; title?: string; description?: string }[];
		resourceTemplates?: { uriTemplate: string; name: string }[];
		messages?: { role: string; content: { type: string; text: string } }[];
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

describe("agent surfaces", () => {
	it("ships behaviour annotations on every listed tool", async () => {
		const listed = (await parse(await handleMcpRequest(rpc("tools/list"), fakeCtx))).result.tools;
		expect(listed?.length).toBe(mcpTools.length);
		for (const tool of listed ?? []) {
			expect(tool.annotations, `${tool.name} has no annotations`).toBeDefined();
			expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
			expect(typeof tool.annotations?.destructiveHint, tool.name).toBe("boolean");
			expect(tool.annotations?.title, tool.name).toBeTruthy();
		}
	});

	it("marks the read tools read-only and the disruptive ones destructive", async () => {
		const listed = (await parse(await handleMcpRequest(rpc("tools/list"), fakeCtx))).result.tools;
		const byName = new Map((listed ?? []).map((tool) => [tool.name, tool.annotations]));
		expect(byName.get("list_projects")?.readOnlyHint).toBe(true);
		expect(byName.get("get_service_events")?.readOnlyHint).toBe(true);
		expect(byName.get("deploy_service")?.readOnlyHint).toBe(false);
		expect(byName.get("stop_service")?.destructiveHint).toBe(true);
		expect(byName.get("rollback_deployment")?.destructiveHint).toBe(true);
	});

	it("lists the two investigations as prompts", async () => {
		const result = (await parse(await handleMcpRequest(rpc("prompts/list"), fakeCtx))).result;
		expect((result.prompts ?? []).map((prompt) => prompt.name).sort()).toEqual([
			"explain_failed_deploy",
			"troubleshoot_service",
		]);
	});

	it("renders a prompt into a plan that names the tools to use", async () => {
		const result = (
			await parse(
				await handleMcpRequest(
					rpc("prompts/get", { name: "troubleshoot_service", arguments: { service: "api" } }),
					fakeCtx,
				),
			)
		).result;
		const text = result.messages?.[0]?.content.text ?? "";
		expect(text).toContain('"api"');
		expect(text).toContain("get_service_runtime_summary");
		expect(text).toContain("get_service_events");
		// A plan, not a licence: an investigation prompt must not invite the
		// agent to change anything while it is looking.
		expect(text.replace(/\s+/g, " ")).toContain(
			"Do not deploy, restart, stop or roll anything back",
		);
	});

	it("exposes the service and deployment-log resource templates", async () => {
		const result = (await parse(await handleMcpRequest(rpc("resources/templates/list"), fakeCtx)))
			.result;
		expect((result.resourceTemplates ?? []).map((entry) => entry.uriTemplate).sort()).toEqual([
			"nixploy://deployment/{deploymentId}/log",
			"nixploy://service/{applicationId}",
		]);
	});
});
