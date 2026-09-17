import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getTRPCErrorFromUnknown } from "@trpc/server";
import type { TRPCContext } from "../../trpc/init";
import { appRouter } from "../../trpc/root";
import { MCP_TOOL_ANNOTATIONS } from "./annotations";
import { mcpPrompts } from "./prompts";
import {
	DEPLOYMENT_LOG_RESOURCE_TEMPLATE,
	readDeploymentLogResource,
	readServiceResource,
	SERVICE_RESOURCE_TEMPLATE,
} from "./resources";
import { mcpTools } from "./tools";

/**
 * MCP server over the Streamable HTTP transport (web-standard Request /
 * Response, so it runs directly inside the Next.js route handler).
 *
 * Stateless mode: a fresh McpServer + transport per HTTP request. There is no
 * server-side session state, so nothing can leak between tenants and an app
 * restart loses nothing; the caller's tRPC context (API-key user + resolved
 * organization) is captured per request and every tool call goes through the
 * routers' org scoping and capability checks.
 */
export function createMcpServer(ctx: TRPCContext): McpServer {
	const server = new McpServer({ name: "nixploy", version: "1.0.0" });
	for (const tool of mcpTools) {
		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.inputSchema,
				// Behaviour hints, so a host knows what to confirm and an agent
				// knows what it can call while "just looking" (./annotations.ts).
				annotations: MCP_TOOL_ANNOTATIONS[tool.name],
			},
			async (args) => {
				try {
					const caller = appRouter.createCaller(ctx);
					const result = await tool.handler(caller, args as never);
					// Compact JSON — agents parse the text payload.
					return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
				} catch (error) {
					const trpcError = getTRPCErrorFromUnknown(error);
					return {
						content: [{ type: "text" as const, text: `${trpcError.code}: ${trpcError.message}` }],
						isError: true,
					};
				}
			},
		);
	}

	for (const prompt of mcpPrompts) {
		server.registerPrompt(
			prompt.name,
			{
				title: prompt.title,
				description: prompt.description,
				argsSchema: prompt.argsSchema,
			},
			(args) => ({
				messages: [
					{
						role: "user" as const,
						content: {
							type: "text" as const,
							text: prompt.render(args as Record<string, string | undefined>),
						},
					},
				],
			}),
		);
	}

	// `list: undefined` on both templates is deliberate. Enumerating every
	// service and every deployment of an organization into a resource list is a
	// lot of payload for something a host renders as a picker, and the tools
	// already answer "what is there" with pagination and filters. A URI built
	// from an id the agent already has resolves fine.
	server.registerResource(
		"service",
		new ResourceTemplate(SERVICE_RESOURCE_TEMPLATE, { list: undefined }),
		{
			title: "Service",
			description:
				"An application's current state and its last events, as JSON. Scoped to the caller's organization like every other read.",
			mimeType: "application/json",
		},
		async (uri, variables) => {
			const caller = appRouter.createCaller(ctx);
			const { text, mimeType } = await readServiceResource(caller, String(variables.applicationId));
			return { contents: [{ uri: uri.href, mimeType, text }] };
		},
	);

	server.registerResource(
		"deployment-log",
		new ResourceTemplate(DEPLOYMENT_LOG_RESOURCE_TEMPLATE, { list: undefined }),
		{
			title: "Deployment log",
			description: "The build log of one deployment, truncated to its tail.",
			mimeType: "text/plain",
		},
		async (uri, variables) => {
			const caller = appRouter.createCaller(ctx);
			const { text, mimeType } = await readDeploymentLogResource(
				caller,
				String(variables.deploymentId),
			);
			return { contents: [{ uri: uri.href, mimeType, text }] };
		},
	);

	return server;
}

/**
 * Handle one HTTP request against the MCP endpoint. POST carries JSON-RPC
 * messages (initialize, tools/list, tools/call); GET/DELETE are answered by
 * the transport per the Streamable HTTP spec (405 in stateless mode).
 * Auth must happen before this is called — see the route adapter.
 */
export async function handleMcpRequest(req: Request, ctx: TRPCContext): Promise<Response> {
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		// Plain JSON responses instead of SSE streams: tool calls here are
		// request/response (no progress streaming), and JSON survives proxies
		// and simple clients better.
		enableJsonResponse: true,
	});
	const server = createMcpServer(ctx);
	await server.connect(transport);
	req.signal.addEventListener("abort", () => {
		void transport.close();
		void server.close();
	});
	return transport.handleRequest(req);
}
