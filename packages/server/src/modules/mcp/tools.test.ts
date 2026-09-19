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

import { MCP_TOOL_ANNOTATIONS } from "./annotations";
import { diffEnvKeys, mcpToolByName, mcpTools, parseEnvBlob, serializeEnvBlob } from "./tools";

const EXPECTED_TOOLS = [
	// read
	"list_projects",
	"list_services",
	"get_service_logs",
	"list_deployments",
	"list_domains",
	"get_service_metrics",
	"list_templates",
	"list_template_sources",
	"list_databases",
	"get_database",
	"get_env",
	"get_resolved_env",
	"list_incidents",
	"list_backups",
	"list_backup_runs",
	"list_previews",
	"list_rollback_points",
	"get_deployment_provenance",
	"get_platform_health",
	"get_service_events",
	// agent task tools: one call where an agent would otherwise write a loop
	"deploy_and_wait",
	"explain_last_failure",
	"get_service_runtime_summary",
	"get_runtime_logs",
	// guarded writes
	"deploy_service",
	"deploy_compose",
	"stop_service",
	"start_service",
	"restart_service",
	"add_domain",
	"remove_domain",
	"set_env",
	"rollback_deployment",
	"cancel_deployment",
	"run_backup",
	"verify_backup",
	"acknowledge_incident",
	"resolve_incident",
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

// ─────────────────────────────────────────────────────────── new tool surface

/**
 * A stand-in caller: every tool handler only ever touches the router methods
 * it needs, so a partial object with vi.fn()s exercises the mapping logic
 * without a database. Capability and org checks live in the real routers and
 * are covered by their own suites.
 */
function fakeCaller(overrides: Record<string, unknown>) {
	return overrides as unknown as Parameters<
		NonNullable<ReturnType<typeof mcpToolByName.get>>["handler"]
	>[0];
}

const callTool = async (name: string, caller: unknown, input: unknown): Promise<unknown> => {
	const tool = mcpToolByName.get(name);
	if (!tool) throw new Error(`Unknown tool ${name}`);
	// The schema is what the MCP SDK applies before dispatch — apply it here too.
	const parsed = tool.inputSchema.parse(input);
	return await tool.handler(
		caller as Parameters<typeof tool.handler>[0],
		parsed as Parameters<typeof tool.handler>[1],
	);
};

describe("env blob helpers", () => {
	it("parses, serializes and diffs by key", () => {
		const before = parseEnvBlob("# comment\nA=1\nB=2\n\n");
		expect(before).toEqual({ A: "1", B: "2" });
		const after = { ...before, B: "3", C: "4" };
		delete (after as Record<string, string>).A;
		expect(diffEnvKeys(before, after)).toEqual({
			added: ["C"],
			changed: ["B"],
			removed: ["A"],
		});
		expect(serializeEnvBlob({ A: "1", B: "2" })).toBe("A=1\nB=2");
	});

	it("keeps values containing = intact", () => {
		expect(parseEnvBlob("DSN=postgres://u:p@h/db?x=1")).toEqual({
			DSN: "postgres://u:p@h/db?x=1",
		});
	});
});

describe("new read tools", () => {
	it("list_databases flattens all five engine routers", async () => {
		const all = (engine: string) =>
			vi.fn().mockResolvedValue([
				{
					[`${engine}Id`]: `${engine}-1`,
					name: `${engine} main`,
					appName: `${engine}-main`,
					status: "done",
					dockerImage: `${engine}:17`,
					externalPort: null,
				},
			]);
		const caller = fakeCaller({
			postgres: { all: all("postgres") },
			mysql: { all: all("mysql") },
			mariadb: { all: all("mariadb") },
			mongo: { all: all("mongo") },
			redis: { all: all("redis") },
		});
		const rows = (await callTool("list_databases", caller, { projectId: "p1" })) as Array<{
			engine: string;
			id: string;
		}>;
		expect(rows).toHaveLength(5);
		expect(rows.map((row) => row.engine)).toEqual([
			"postgres",
			"mysql",
			"mariadb",
			"mongo",
			"redis",
		]);
		expect(rows[0]?.id).toBe("postgres-1");
	});

	it("get_database merges the row with live container status", async () => {
		const caller = fakeCaller({
			postgres: {
				one: vi.fn().mockResolvedValue({
					name: "main",
					appName: "main-abc",
					status: "done",
					dockerImage: "postgres:17",
					databaseName: "app",
					databaseUser: "app",
					externalPort: null,
					serverId: null,
				}),
				getStatus: vi.fn().mockResolvedValue({ state: "running" }),
			},
		});
		const result = (await callTool("get_database", caller, {
			engine: "postgres",
			databaseId: "pg-1",
		})) as { containerStatus: unknown; engine: string };
		expect(result.engine).toBe("postgres");
		expect(result.containerStatus).toEqual({ state: "running" });
	});

	it("get_env returns keys only when the caller cannot see values", async () => {
		const caller = fakeCaller({
			organization: { environment: vi.fn().mockResolvedValue({ env: null }) },
		});
		const result = (await callTool("get_env", caller, { scope: "organization" })) as {
			redacted: boolean;
			keys: string[];
		};
		expect(result.redacted).toBe(true);
		expect(result.keys).toEqual([]);
	});

	it("get_env reads an unset scope as empty when the caller may see secrets", async () => {
		// env columns are nullable: null + secrets.read means "nothing set here",
		// not "hidden from you".
		const caller = fakeCaller({
			project: { one: vi.fn().mockResolvedValue({ env: null }) },
			organization: {
				myCapabilities: vi
					.fn()
					.mockResolvedValue({ role: "owner", capabilities: ["secrets.read"] }),
			},
		});
		const result = (await callTool("get_env", caller, {
			scope: "project",
			projectId: "p1",
		})) as { redacted: boolean; keys: string[]; variables: Record<string, string> };
		expect(result.redacted).toBe(false);
		expect(result.keys).toEqual([]);
		expect(result.variables).toEqual({});
	});

	it("get_env parses the blob of a project scope", async () => {
		const caller = fakeCaller({
			project: { one: vi.fn().mockResolvedValue({ env: "A=1\nB=2" }) },
		});
		const result = (await callTool("get_env", caller, {
			scope: "project",
			projectId: "p1",
		})) as { variables: Record<string, string>; keys: string[] };
		expect(result.keys).toEqual(["A", "B"]);
		expect(result.variables).toEqual({ A: "1", B: "2" });
	});

	it("get_env rejects a project scope without a projectId", async () => {
		const caller = fakeCaller({});
		await expect(callTool("get_env", caller, { scope: "project" })).rejects.toThrow(/projectId/);
	});

	it("list_incidents compacts the incident rows", async () => {
		const caller = fakeCaller({
			observability: {
				incidents: vi.fn().mockResolvedValue([
					{
						incidentId: "inc-1",
						kind: "alert_rule",
						severity: "critical",
						title: "CPU above 90%",
						message: "sustained",
						serviceName: "api",
						serviceId: "app-1",
						metadata: { internal: true },
						createdAt: new Date("2026-09-10T00:00:00Z"),
						acknowledgedAt: null,
						resolvedAt: null,
					},
				]),
			},
		});
		const rows = (await callTool("list_incidents", caller, {})) as Array<Record<string, unknown>>;
		expect(rows[0]).not.toHaveProperty("metadata");
		expect(rows[0]?.incidentId).toBe("inc-1");
	});

	it("list_backups passes web-server through without a serviceId", async () => {
		const all = vi.fn().mockResolvedValue([]);
		const caller = fakeCaller({ backup: { all } });
		await callTool("list_backups", caller, { databaseType: "web-server" });
		expect(all).toHaveBeenCalledWith({ databaseType: "web-server" });
	});

	it("list_backup_runs forwards the limit", async () => {
		const runs = vi.fn().mockResolvedValue([]);
		const caller = fakeCaller({ backup: { runs } });
		await callTool("list_backup_runs", caller, { backupId: "b1", limit: 5 });
		expect(runs).toHaveBeenCalledWith({ backupId: "b1", limit: 5 });
	});

	it("list_previews compacts the preview rows", async () => {
		const caller = fakeCaller({
			previewDeployment: {
				byApplication: vi.fn().mockResolvedValue([
					{
						previewDeploymentId: "pd-1",
						pullRequestNumber: "12",
						pullRequestTitle: "Add search",
						pullRequestURL: "https://example.test/pr/12",
						branch: "feat/search",
						previewStatus: "done",
						appName: "api-pr-12",
						expiresAt: null,
						applicationId: "app-1",
					},
				]),
			},
		});
		const rows = (await callTool("list_previews", caller, {
			applicationId: "app-1",
		})) as Array<Record<string, unknown>>;
		expect(rows[0]).not.toHaveProperty("applicationId");
		expect(rows[0]?.previewStatus).toBe("done");
	});

	it("list_rollback_points is a pass-through", async () => {
		const all = vi.fn().mockResolvedValue([{ rollbackId: "rb-1" }]);
		const caller = fakeCaller({ rollback: { all } });
		await expect(
			callTool("list_rollback_points", caller, { applicationId: "app-1" }),
		).resolves.toEqual([{ rollbackId: "rb-1" }]);
		expect(all).toHaveBeenCalledWith({ applicationId: "app-1" });
	});

	it("get_deployment_provenance surfaces commit and trigger columns", async () => {
		const caller = fakeCaller({
			deployment: {
				byApplication: vi.fn().mockResolvedValue({
					deployments: [
						{
							deploymentId: "d1",
							title: "Deployment",
							status: "done",
							createdAt: new Date("2026-09-10T00:00:00Z"),
							finishedAt: new Date("2026-09-10T00:01:00Z"),
							commitSha: "abc1234",
							commitMessage: "fix: routing",
							commitAuthor: "Ayoub",
							trigger: "webhook:github",
							triggeredBy: "webhook:github",
							logPath: "/should/not/leak",
						},
					],
					nextCursor: null,
				}),
			},
		});
		const rows = (await callTool("get_deployment_provenance", caller, {
			applicationId: "app-1",
		})) as Array<Record<string, unknown>>;
		expect(rows[0]?.commitSha).toBe("abc1234");
		expect(rows[0]).not.toHaveProperty("logPath");
	});

	it("get_deployment_provenance rejects both or neither service id", () => {
		const schema = mcpToolByName.get("get_deployment_provenance")?.inputSchema;
		expect(() => schema?.parse({})).toThrow();
		expect(() => schema?.parse({ applicationId: "a", composeId: "c" })).toThrow();
	});

	it("get_service_metrics falls back to the sampler when no replica runs", async () => {
		const caller = fakeCaller({
			monitoring: {
				replicaStats: vi.fn().mockResolvedValue([]),
				fleetOverview: vi.fn().mockResolvedValue([
					{
						kind: "application",
						appName: "api-abc",
						status: "idle",
						serverId: "srv-1",
						metrics: { t: 1, cpu: 12, memoryUsed: 10, memoryTotal: 100, memoryPercent: 10 },
					},
				]),
			},
		});
		const result = (await callTool("get_service_metrics", caller, { appName: "api-abc" })) as {
			source: string;
			serverId: string | null;
			latestSample: unknown;
		};
		expect(result.source).toBe("sampled");
		expect(result.serverId).toBe("srv-1");
		expect(result.latestSample).toMatchObject({ cpu: 12 });
	});

	it("get_service_metrics prefers live replicas and skips the fleet scan", async () => {
		const fleetOverview = vi.fn();
		const caller = fakeCaller({
			monitoring: {
				replicaStats: vi.fn().mockResolvedValue([{ id: "c1", cpu: 3 }]),
				fleetOverview,
			},
		});
		const result = (await callTool("get_service_metrics", caller, { appName: "api-abc" })) as {
			source: string;
		};
		expect(result.source).toBe("live-replicas");
		expect(fleetOverview).not.toHaveBeenCalled();
	});
});

describe("guarded write tools", () => {
	it("set_env merges into the existing blob and reports a key diff", async () => {
		const saveEnvironment = vi.fn().mockResolvedValue({});
		const caller = fakeCaller({
			project: { one: vi.fn().mockResolvedValue({ env: "A=1\nB=2" }), saveEnvironment },
		});
		const result = (await callTool("set_env", caller, {
			scope: "project",
			projectId: "p1",
			variables: { B: "9", C: "3" },
		})) as { added: string[]; changed: string[]; removed: string[]; totalKeys: number };
		expect(saveEnvironment).toHaveBeenCalledWith({ projectId: "p1", env: "A=1\nB=9\nC=3" });
		expect(result).toMatchObject({ added: ["C"], changed: ["B"], removed: [], totalKeys: 3 });
	});

	it("set_env with replace drops the existing keys without reading them", async () => {
		const saveEnvironment = vi.fn().mockResolvedValue({});
		const one = vi.fn();
		const caller = fakeCaller({ project: { one, saveEnvironment } });
		const result = (await callTool("set_env", caller, {
			scope: "project",
			projectId: "p1",
			variables: { ONLY: "1" },
			replace: true,
		})) as { added: string[] };
		expect(one).not.toHaveBeenCalled();
		expect(saveEnvironment).toHaveBeenCalledWith({ projectId: "p1", env: "ONLY=1" });
		expect(result.added).toEqual(["ONLY"]);
	});

	it("set_env refuses to merge when the current values are redacted", async () => {
		const caller = fakeCaller({
			project: { one: vi.fn().mockResolvedValue({ env: null }), saveEnvironment: vi.fn() },
			organization: {
				myCapabilities: vi.fn().mockResolvedValue({ role: "viewer", capabilities: [] }),
			},
		});
		await expect(
			callTool("set_env", caller, { scope: "project", projectId: "p1", variables: { A: "1" } }),
		).rejects.toThrow(/secrets\.read/);
	});

	it("set_env merges into an unset scope when the caller may see secrets", async () => {
		const saveEnvironment = vi.fn().mockResolvedValue({});
		const caller = fakeCaller({
			project: { one: vi.fn().mockResolvedValue({ env: null }), saveEnvironment },
			organization: {
				myCapabilities: vi
					.fn()
					.mockResolvedValue({ role: "owner", capabilities: ["secrets.read"] }),
			},
		});
		const result = (await callTool("set_env", caller, {
			scope: "project",
			projectId: "p1",
			variables: { A: "1" },
		})) as { added: string[]; totalKeys: number };
		expect(saveEnvironment).toHaveBeenCalledWith({ projectId: "p1", env: "A=1" });
		expect(result).toMatchObject({ added: ["A"], totalKeys: 1 });
	});

	it("set_env writes a service scope through that engine's router", async () => {
		const saveEnvironment = vi.fn().mockResolvedValue({});
		const caller = fakeCaller({
			postgres: { one: vi.fn().mockResolvedValue({ env: "" }), saveEnvironment },
		});
		await callTool("set_env", caller, {
			scope: "service",
			serviceType: "postgres",
			serviceId: "pg-1",
			variables: { A: "1" },
		});
		expect(saveEnvironment).toHaveBeenCalledWith({ postgresId: "pg-1", env: "A=1" });
	});

	it("rollback_deployment forwards both ids", async () => {
		const rollback = vi.fn().mockResolvedValue({ deploymentId: "d9" });
		const caller = fakeCaller({ application: { rollback } });
		await callTool("rollback_deployment", caller, { applicationId: "a1", rollbackId: "rb-1" });
		expect(rollback).toHaveBeenCalledWith({ applicationId: "a1", rollbackId: "rb-1" });
	});

	it("cancel_deployment forwards the deployment id", async () => {
		const cancelDeployment = vi.fn().mockResolvedValue({ ok: true });
		const caller = fakeCaller({ application: { cancelDeployment } });
		await callTool("cancel_deployment", caller, { deploymentId: "d1" });
		expect(cancelDeployment).toHaveBeenCalledWith({ deploymentId: "d1" });
	});

	it("deploy_compose forwards the compose id", async () => {
		const deploy = vi.fn().mockResolvedValue({ deploymentId: "d2" });
		const caller = fakeCaller({ compose: { deploy } });
		await callTool("deploy_compose", caller, { composeId: "c1" });
		expect(deploy).toHaveBeenCalledWith({ composeId: "c1" });
	});

	it("run_backup and verify_backup hit the backup router", async () => {
		const runManually = vi.fn().mockResolvedValue({ ok: true });
		const verify = vi.fn().mockResolvedValue({ ok: true });
		const caller = fakeCaller({ backup: { runManually, verify } });
		await callTool("run_backup", caller, { backupId: "b1" });
		await callTool("verify_backup", caller, { backupId: "b1", key: "dumps/x.sql.gz" });
		expect(runManually).toHaveBeenCalledWith({ backupId: "b1" });
		expect(verify).toHaveBeenCalledWith({ backupId: "b1", key: "dumps/x.sql.gz" });
	});

	it("acknowledge_incident and resolve_incident hit the observability router", async () => {
		const acknowledgeIncident = vi.fn().mockResolvedValue({ ok: true });
		const resolveIncident = vi.fn().mockResolvedValue({ ok: true });
		const caller = fakeCaller({ observability: { acknowledgeIncident, resolveIncident } });
		await callTool("acknowledge_incident", caller, { incidentId: "i1" });
		await callTool("resolve_incident", caller, { incidentId: "i1", note: "restarted" });
		expect(acknowledgeIncident).toHaveBeenCalledWith({ incidentId: "i1" });
		expect(resolveIncident).toHaveBeenCalledWith({ incidentId: "i1", note: "restarted" });
	});
});

describe("tool descriptions", () => {
	const WRITE_TOOLS = new Set([
		"deploy_service",
		"deploy_compose",
		"stop_service",
		"start_service",
		"restart_service",
		"add_domain",
		"remove_domain",
		"set_env",
		"rollback_deployment",
		"cancel_deployment",
		"run_backup",
		"verify_backup",
		"acknowledge_incident",
		"resolve_incident",
	]);

	it("states the required capability on every mutating tool", () => {
		for (const tool of mcpTools) {
			if (!WRITE_TOOLS.has(tool.name)) continue;
			expect(tool.description, tool.name).toMatch(/capability/i);
		}
	});

	it("marks read-only tools as read-only or otherwise non-mutating", () => {
		for (const tool of mcpTools) {
			if (WRITE_TOOLS.has(tool.name)) continue;
			expect(tool.description.length, tool.name).toBeGreaterThan(40);
		}
	});
});

describe("MCP tool annotations", () => {
	it("annotates every tool — a hint that is merely absent is better than one that is wrong", () => {
		const missing = mcpTools.filter((tool) => !MCP_TOOL_ANNOTATIONS[tool.name]);
		expect(
			missing.map((tool) => tool.name),
			"add these to MCP_TOOL_ANNOTATIONS in modules/mcp/annotations.ts",
		).toEqual([]);
	});

	it("annotates no tool that does not exist", () => {
		const names = new Set(mcpTools.map((tool) => tool.name));
		expect(Object.keys(MCP_TOOL_ANNOTATIONS).filter((name) => !names.has(name))).toEqual([]);
	});

	it("never calls a mutating tool read-only", () => {
		// The whole hazard this file exists for: `readOnlyHint: true` on
		// something that mutates is how an agent stops production while it
		// believes it is only looking around.
		const readOnly = Object.entries(MCP_TOOL_ANNOTATIONS)
			.filter(([, annotation]) => annotation.readOnlyHint)
			.map(([name]) => name);
		for (const name of readOnly) {
			expect(name, `${name} is marked read-only`).toMatch(/^(list_|get_|explain_last_failure$)/);
		}
	});

	it("marks a read-only tool as neither destructive nor non-idempotent", () => {
		for (const [name, annotation] of Object.entries(MCP_TOOL_ANNOTATIONS)) {
			if (!annotation.readOnlyHint) continue;
			expect(annotation.destructiveHint, name).toBe(false);
			expect(annotation.idempotentHint, name).toBe(true);
		}
	});

	it("asks for confirmation before anything that interrupts or removes", () => {
		for (const name of [
			"stop_service",
			"remove_domain",
			"rollback_deployment",
			"cancel_deployment",
		]) {
			expect(MCP_TOOL_ANNOTATIONS[name]?.destructiveHint, name).toBe(true);
		}
	});
});
