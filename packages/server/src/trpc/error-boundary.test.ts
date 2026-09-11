import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getTRPCErrorFromUnknown, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TRPCContext } from "./init";

/**
 * The error boundary in `init.ts` is the single place a module's DomainError,
 * a zod input failure or an unexpected Error is turned into the TRPCError the
 * transports show (audit 2026-09 code-health F1). Every transport is
 * exercised against the same fake router: the fetch adapter (`/api/trpc`),
 * the REST adapter (`/api/<router>.<proc>`) and the MCP server.
 */

// `init.ts` builds better-auth at import time from the schema barrel; keep the
// real module and only blank the query client.
vi.mock("../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../db")>();
	return { ...actual, db: { query: {} }, client: vi.fn() };
});

// The REST adapter and the MCP server resolve procedures from the real
// `appRouter`; swap it for the fake router so no module code runs.
vi.mock("./root", async () => {
	const { router, publicProcedure, protectedProcedure } = await import("./init");
	const { badRequest, conflict, notFound } = await import("../modules/errors");
	const fakeRouter = router({
		fake: router({
			create: publicProcedure
				.input(
					z.object({
						name: z.string().min(1),
						port: z.number().max(65535).optional(),
					}),
				)
				.mutation(({ input }) => ({ name: input.name })),
			boom: publicProcedure.mutation(() => {
				throw badRequest("x");
			}),
			one: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
				throw notFound(`Project ${input.id} not found`);
			}),
			guarded: protectedProcedure.mutation(() => {
				throw conflict("appName is already in use");
			}),
			crash: publicProcedure.mutation(() => {
				throw new Error("db exploded");
			}),
			explicit: publicProcedure.mutation(() => {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Traefik reload failed",
				});
			}),
		}),
	});
	return { appRouter: fakeRouter };
});

vi.mock("../lib/api-key-context", () => ({
	buildApiKeyContext: async () => ({ headers: new Headers(), session: null }),
}));

vi.mock("../modules/mcp/tools", () => ({
	mcpTools: [
		{
			name: "boom",
			description: "always fails with a DomainError",
			inputSchema: z.object({}),
			handler: async (caller: { fake: { boom: () => Promise<unknown> } }) => caller.fake.boom(),
		},
		{
			name: "create",
			description: "zod-validated create",
			inputSchema: z.object({ name: z.string() }),
			handler: async (
				caller: {
					fake: { create: (input: { name: string }) => Promise<unknown> };
				},
				input: { name: string },
			) => caller.fake.create(input),
		},
	],
}));

import { createMcpServer } from "../modules/mcp/server";
import { flattenZodIssues, GENERIC_INTERNAL_ERROR_MESSAGE, normalizeTRPCError } from "./init";
import { appRouter } from "./root";

const anonymousCtx = {
	headers: new Headers(),
	session: null,
} as unknown as TRPCContext;
const memberCtx = {
	headers: new Headers(),
	session: {
		session: { activeOrganizationId: "org-1" },
		user: { id: "user-1", role: "user", twoFactorEnabled: false },
	},
} as unknown as TRPCContext;

type FakeCaller = {
	fake: {
		create: (input: { name: string; port?: number }) => Promise<{ name: string }>;
		boom: () => Promise<unknown>;
		one: (input: { id: string }) => Promise<unknown>;
		guarded: () => Promise<unknown>;
		crash: () => Promise<unknown>;
		explicit: () => Promise<unknown>;
	};
};
const caller = (ctx: TRPCContext) => appRouter.createCaller(ctx) as unknown as FakeCaller;

async function rejection(promise: Promise<unknown>): Promise<TRPCError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(TRPCError);
		return error as TRPCError;
	}
	throw new Error("expected the call to reject");
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("flattenZodIssues", () => {
	it("joins path and message per issue", () => {
		expect(
			flattenZodIssues([
				{
					path: ["name"],
					message: "Too small: expected string to have >=1 characters",
				},
				{
					path: ["ports", 0, "target"],
					message: "Too big: expected number to be <=65535",
				},
				{ path: [], message: "Unrecognized key: extra" },
			]),
		).toBe(
			"name: Too small: expected string to have >=1 characters; ports.0.target: Too big: expected number to be <=65535; Unrecognized key: extra",
		);
	});
});

describe("createCaller (the seam REST and MCP share)", () => {
	it("maps a DomainError thrown by a module to its code and message", async () => {
		const error = await rejection(caller(anonymousCtx).fake.boom());
		expect(error.code).toBe("BAD_REQUEST");
		expect(error.message).toBe("x");
		// Same call the REST and MCP adapters make on the way out.
		expect(getTRPCErrorFromUnknown(error).code).toBe("BAD_REQUEST");
	});

	it("keeps the boundary on protectedProcedure", async () => {
		const error = await rejection(caller(memberCtx).fake.guarded());
		expect(error.code).toBe("CONFLICT");
		expect(error.message).toBe("appName is already in use");
	});

	it("maps NOT_FOUND from a query", async () => {
		const error = await rejection(caller(anonymousCtx).fake.one({ id: "nope" }));
		expect(error.code).toBe("NOT_FOUND");
		expect(error.message).toBe("Project nope not found");
	});

	it("flattens zod input failures into a readable BAD_REQUEST", async () => {
		const error = await rejection(caller(anonymousCtx).fake.create({ name: "", port: 99999 }));
		expect(error.code).toBe("BAD_REQUEST");
		expect(error.message).toBe(
			"name: Too small: expected string to have >=1 characters; port: Too big: expected number to be <=65535",
		);
		expect(error.message.startsWith("[")).toBe(false);
	});

	it("keeps the real message for unexpected errors outside production", async () => {
		vi.stubEnv("NODE_ENV", "test");
		const error = await rejection(caller(anonymousCtx).fake.crash());
		expect(error.code).toBe("INTERNAL_SERVER_ERROR");
		expect(error.message).toBe("db exploded");
	});

	it("replaces unexpected error messages with a generic one in production", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const error = await rejection(caller(anonymousCtx).fake.crash());
		expect(error.code).toBe("INTERNAL_SERVER_ERROR");
		expect(error.message).toBe(GENERIC_INTERNAL_ERROR_MESSAGE);
		expect(error.cause).toBeInstanceOf(Error);
	});

	it("leaves an explicit TRPCError from a router untouched, even in production", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const error = await rejection(caller(anonymousCtx).fake.explicit());
		expect(error.code).toBe("INTERNAL_SERVER_ERROR");
		expect(error.message).toBe("Traefik reload failed");
	});
});

describe("normalizeTRPCError", () => {
	it("returns the same instance when nothing needs mapping", () => {
		const error = new TRPCError({ code: "FORBIDDEN", message: "nope" });
		expect(normalizeTRPCError(error, "x.y")).toBe(error);
	});
});

describe("fetch adapter (/api/trpc)", () => {
	async function post(path: string, input: unknown) {
		const res = await fetchRequestHandler({
			endpoint: "/api/trpc",
			req: new Request(`http://localhost/api/trpc/${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ json: input }),
			}),
			router: appRouter,
			createContext: () => anonymousCtx,
		});
		const body = (await res.json()) as {
			error?: { json: { message: string; data: Record<string, unknown> } };
		};
		return { status: res.status, error: body.error?.json };
	}

	it("ships the flattened zod message plus structured issues", async () => {
		const { status, error } = await post("fake.create", { name: "" });
		expect(status).toBe(400);
		expect(error?.message).toBe("name: Too small: expected string to have >=1 characters");
		expect(error?.data.code).toBe("BAD_REQUEST");
		expect(error?.data.zodIssues).toEqual([
			expect.objectContaining({ code: "too_small", path: ["name"] }),
		]);
	});

	it("ships a DomainError with its HTTP status", async () => {
		const { status, error } = await post("fake.boom", undefined);
		expect(status).toBe(400);
		expect(error?.message).toBe("x");
		expect(error?.data.code).toBe("BAD_REQUEST");
		expect(error?.data.httpStatus).toBe(400);
	});
});

describe("REST adapter (/api/<router>.<procedure>)", () => {
	type RestRoute = {
		GET: (req: Request, ctx: { params: Promise<{ rest: string[] }> }) => Promise<Response>;
		POST: (req: Request, ctx: { params: Promise<{ rest: string[] }> }) => Promise<Response>;
	};
	// Runtime path on purpose: the route lives in apps/web, outside this package's
	// tsconfig rootDir. It has to be absolute — a relative specifier handed to a
	// runtime `import()` is not resolved against this file.
	const routePath = decodeURIComponent(
		new URL("../../../../apps/web/src/app/api/[...rest]/route.ts", import.meta.url).pathname,
	);
	async function loadRoute(): Promise<RestRoute> {
		return (await import(/* @vite-ignore */ routePath)) as RestRoute;
	}

	async function call(method: "GET" | "POST", path: string, input?: unknown) {
		const { GET, POST } = await loadRoute();
		const url =
			method === "GET" && input !== undefined
				? `http://localhost/api/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
				: `http://localhost/api/${path}`;
		const req = new Request(url, {
			method,
			headers: { "content-type": "application/json", "x-api-key": "k" },
			body: method === "POST" && input !== undefined ? JSON.stringify(input) : undefined,
		});
		const params = Promise.resolve({ rest: [path] });
		const res = await (method === "GET" ? GET : POST)(req, { params });
		const body = (await res.json()) as {
			message: string;
			error?: { code: number; data: { code: string; httpStatus: number } };
		};
		return { status: res.status, body };
	}

	it("answers a zod failure with 400 and a readable message", async () => {
		const { status, body } = await call("POST", "fake.create", { name: "" });
		expect(status).toBe(400);
		expect(body.message).toBe("name: Too small: expected string to have >=1 characters");
		expect(body.error?.data.code).toBe("BAD_REQUEST");
	});

	it("answers a DomainError with its status", async () => {
		const boom = await call("POST", "fake.boom");
		expect(boom.status).toBe(400);
		expect(boom.body.message).toBe("x");

		const missing = await call("GET", "fake.one", { id: "nope" });
		expect(missing.status).toBe(404);
		expect(missing.body.message).toBe("Project nope not found");
		expect(missing.body.error?.data.code).toBe("NOT_FOUND");
	});
});

describe("MCP server", () => {
	async function connect() {
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const server = createMcpServer(anonymousCtx);
		await server.connect(serverTransport);
		const client = new Client({ name: "test", version: "0.0.0" });
		await client.connect(clientTransport);
		return {
			client,
			close: async () => {
				await client.close();
				await server.close();
			},
		};
	}

	it("returns the mapped code and message as a tool error", async () => {
		const { client, close } = await connect();
		try {
			const result = (await client.callTool({
				name: "boom",
				arguments: {},
			})) as {
				isError?: boolean;
				content: Array<{ type: string; text?: string }>;
			};
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toBe("BAD_REQUEST: x");
		} finally {
			await close();
		}
	});

	it("returns the flattened zod message for invalid input", async () => {
		const { client, close } = await connect();
		try {
			const result = (await client.callTool({
				name: "create",
				arguments: { name: "" },
			})) as {
				isError?: boolean;
				content: Array<{ type: string; text?: string }>;
			};
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toBe(
				"BAD_REQUEST: name: Too small: expected string to have >=1 characters",
			);
		} finally {
			await close();
		}
	});
});
