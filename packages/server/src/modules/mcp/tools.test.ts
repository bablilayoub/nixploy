import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TRPCContext } from "../../trpc/init";
import { appRouter } from "../../trpc/root";

// Mock the database boundary: every router imports { db, client } from here.
// Module load is lazy (no connection at import time), so replacing the
// exported objects with vi.fn()-backed stand-ins is enough.
const mocks = vi.hoisted(() => ({
	findManyProjects: vi.fn(),
	findFirstMember: vi.fn(),
}));
vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	return {
		...actual,
		db: {
			query: {
				projects: { findMany: mocks.findManyProjects },
				members: { findFirst: mocks.findFirstMember },
			},
		},
		client: vi.fn(),
	};
});

import { mcpToolByName, mcpTools } from "./tools";

const EXPECTED_TOOLS = [
	"list_projects",
	"list_services",
	"get_service_logs",
	"list_deployments",
	"deploy_service",
	"stop_service",
	"start_service",
	"restart_service",
	"list_domains",
	"add_domain",
	"remove_domain",
	"get_service_metrics",
	"list_templates",
];

const fakeCtx = {
	headers: new Headers(),
	session: {
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-1" },
	},
} as unknown as TRPCContext;

const callerFor = () => appRouter.createCaller(fakeCtx);

describe("mcp tool registry", () => {
	it("exposes exactly the expected tool set, each with description, schema and handler", () => {
		expect(mcpTools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
		expect(new Set(mcpTools.map((tool) => tool.name)).size).toBe(mcpTools.length);
		for (const tool of mcpTools) {
			expect(tool.description.length).toBeGreaterThan(10);
			expect(typeof tool.inputSchema.parse).toBe("function");
			expect(typeof tool.handler).toBe("function");
			expect(mcpToolByName.get(tool.name)).toBe(tool);
		}
	});
});

describe("tool input validation", () => {
	it("rejects remove_domain without a domainId", () => {
		expect(() => mcpToolByName.get("remove_domain")?.inputSchema.parse({})).toThrow();
	});

	it("rejects add_domain without a host or with both parents", () => {
		const schema = mcpToolByName.get("add_domain")?.inputSchema;
		expect(() => schema?.parse({ applicationId: "app-1" })).toThrow();
		expect(() =>
			schema?.parse({ host: "app.example.com", applicationId: "a", composeId: "c" }),
		).toThrow();
	});

	it("rejects list_deployments with both or neither service id", () => {
		const schema = mcpToolByName.get("list_deployments")?.inputSchema;
		expect(() => schema?.parse({})).toThrow();
		expect(() => schema?.parse({ applicationId: "a", composeId: "c" })).toThrow();
		expect(() => schema?.parse({ applicationId: "a" })).not.toThrow();
	});

	it("rejects get_service_logs without any target", () => {
		expect(() => mcpToolByName.get("get_service_logs")?.inputSchema.parse({})).toThrow();
	});

	it("rejects list_domains without exactly one parent id", () => {
		const schema = mcpToolByName.get("list_domains")?.inputSchema;
		expect(() => schema?.parse({})).toThrow();
		expect(() => schema?.parse({ applicationId: "a", projectId: "p" })).toThrow();
		expect(() => schema?.parse({ projectId: "p" })).not.toThrow();
	});

	it("rejects out-of-range ports and limits", () => {
		expect(() =>
			mcpToolByName.get("add_domain")?.inputSchema.parse({
				host: "app.example.com",
				applicationId: "a",
				port: 70000,
			}),
		).toThrow();
		expect(() =>
			mcpToolByName.get("list_deployments")?.inputSchema.parse({ applicationId: "a", limit: 0 }),
		).toThrow();
	});
});

describe("tool handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("list_templates returns the static catalog without touching the db", async () => {
		const result = (await mcpToolByName
			.get("list_templates")
			?.handler(callerFor(), {} as never)) as unknown[];
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBeGreaterThan(0);
		expect(mocks.findManyProjects).not.toHaveBeenCalled();
	});

	it("list_projects maps the caller's org projects to a compact shape", async () => {
		const membership = { role: "owner", capabilityOverrides: null };
		mocks.findFirstMember.mockResolvedValue(membership);
		mocks.findManyProjects.mockResolvedValue([
			{
				projectId: "proj-1",
				name: "Shop",
				description: "storefront",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				env: "SECRET=should-not-leak",
				environments: [],
			},
		]);

		const result = (await mcpToolByName
			.get("list_projects")
			?.handler(callerFor(), {} as never)) as {
			projectId: string;
			name: string;
			environments: unknown[];
		}[];

		expect(result).toEqual([
			{
				projectId: "proj-1",
				name: "Shop",
				description: "storefront",
				createdAt: new Date("2026-01-01T00:00:00Z"),
				environments: [],
			},
		]);
		// Org resolution + capability check both go through the member table.
		expect(mocks.findFirstMember).toHaveBeenCalled();
	});

	it("list_projects surfaces router errors (unknown org membership)", async () => {
		mocks.findFirstMember.mockResolvedValue(null);
		await expect(
			mcpToolByName.get("list_projects")?.handler(callerFor(), {} as never),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
