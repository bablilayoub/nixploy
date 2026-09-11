import { beforeEach, describe, expect, it, vi } from "vitest";

const { docker, rows, updates } = vi.hoisted(() => ({
	docker: {
		listServicesCalls: 0,
		listTasksCalls: 0,
		fail: false,
		services: [] as Array<Record<string, unknown>>,
		tasks: [] as Array<Record<string, unknown>>,
	},
	rows: {
		applications: [] as Array<Record<string, unknown>>,
		compose: [] as Array<Record<string, unknown>>,
	},
	updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock("./docker", () => ({
	getDocker: async () => ({
		listServices: async () => {
			docker.listServicesCalls += 1;
			if (docker.fail) throw new Error("docker socket unreachable");
			return docker.services;
		},
		listTasks: async () => {
			docker.listTasksCalls += 1;
			return docker.tasks;
		},
	}),
}));

vi.mock("../../db", () => {
	const tableName = (table: unknown) =>
		String((table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown");
	const empty = { findMany: async () => [] };
	return {
		db: {
			query: {
				deployments: { findMany: async () => [] },
				applications: { findMany: async () => rows.applications },
				compose: { findMany: async () => rows.compose },
				postgres: empty,
				mysql: empty,
				mariadb: empty,
				mongo: empty,
				redis: empty,
				environments: { findMany: async () => [] },
			},
			update: (table: unknown) => ({
				set: (values: Record<string, unknown>) => {
					updates.push({ table: tableName(table), values });
					return { where: async () => [] };
				},
			}),
		},
	};
});

vi.mock("../notifications", () => ({ notifyEvent: async () => {} }));

// Plain-compose probes shell out; keep them offline and deterministic.
const { shell } = vi.hoisted(() => ({ shell: { commands: [] as string[], out: "" } }));
vi.mock("../../utils/exec", () => ({
	execAsync: async (command: string) => {
		shell.commands.push(command);
		return shell.out;
	},
	execAsyncRemote: async (_serverId: string, command: string) => {
		shell.commands.push(command);
		return shell.out;
	},
}));

import { loadSwarmSnapshot, reconcileServiceStatuses, reconcileStatus } from "./reconciler";

const service = (id: string, name: string, labels?: Record<string, string>) => ({
	ID: id,
	Spec: { Name: name, Mode: { Replicated: { Replicas: 1 } }, Labels: labels ?? {} },
});
const task = (serviceId: string, state: string) => ({
	ServiceID: serviceId,
	Status: { State: state },
});

beforeEach(() => {
	docker.listServicesCalls = 0;
	docker.listTasksCalls = 0;
	docker.fail = false;
	docker.services = [];
	docker.tasks = [];
	rows.applications = [];
	rows.compose = [];
	updates.length = 0;
	shell.commands = [];
	shell.out = "";
});

describe("reconcileStatus", () => {
	it("normalizes done/error/idle to running when tasks are live", () => {
		expect(reconcileStatus("error", "running")).toBe("running");
		expect(reconcileStatus("idle", "running")).toBe("running");
		expect(reconcileStatus("done", "running")).toBe("running");
		expect(reconcileStatus("running", "running")).toBe("running");
	});

	it("downgrades running/done to idle when nothing is deployed or scaled to zero", () => {
		expect(reconcileStatus("running", "idle")).toBe("idle");
		expect(reconcileStatus("done", "idle")).toBe("idle");
	});

	it("keeps error when nothing is live (failed deploy record)", () => {
		expect(reconcileStatus("error", "idle")).toBe("error");
		expect(reconcileStatus("idle", "idle")).toBe("idle");
	});

	it("marks crash-looping services as error", () => {
		expect(reconcileStatus("error", "error")).toBe("error");
		expect(reconcileStatus("done", "error")).toBe("error");
		expect(reconcileStatus("running", "error")).toBe("error");
		expect(reconcileStatus("idle", "error")).toBe("error");
	});
});

describe("loadSwarmSnapshot", () => {
	it("reads every service in one listServices + one listTasks and groups by ServiceID", async () => {
		docker.services = [service("s1", "shop"), service("s2", "api")];
		docker.tasks = [
			task("s1", "running"),
			task("s1", "failed"),
			task("s2", "starting"),
			task("unknown", "running"),
		];

		const snapshot = await loadSwarmSnapshot();

		expect(docker.listServicesCalls).toBe(1);
		expect(docker.listTasksCalls).toBe(1);
		expect(snapshot?.byName.get("shop")).toEqual({
			exists: true,
			desired: 1,
			running: 1,
			pending: 0,
			failed: 1,
		});
		expect(snapshot?.byName.get("api")).toMatchObject({ running: 0, pending: 1, failed: 0 });
		expect(snapshot?.byName.get("gone")).toBeUndefined();
	});

	it("indexes stack services by their namespace label", async () => {
		docker.services = [
			service("s1", "blog_web", { "com.docker.stack.namespace": "blog" }),
			service("s2", "blog_db", { "com.docker.stack.namespace": "blog" }),
			service("s3", "other", {}),
		];
		docker.tasks = [task("s1", "running")];

		const snapshot = await loadSwarmSnapshot();
		expect(snapshot?.byStack.get("blog")).toEqual(["blog_web", "blog_db"]);
		expect(snapshot?.byStack.get("other")).toBeUndefined();
	});

	it("returns null when the daemon cannot be read", async () => {
		docker.fail = true;
		expect(await loadSwarmSnapshot()).toBeNull();
	});
});

describe("reconcileServiceStatuses batching", () => {
	it("probes N services with a single pair of Docker API calls", async () => {
		rows.applications = [
			{ applicationId: "a1", appName: "shop", status: "idle", serverId: null, environmentId: "e1" },
			{ applicationId: "a2", appName: "api", status: "idle", serverId: null, environmentId: "e1" },
			{
				applicationId: "a3",
				appName: "gone",
				status: "running",
				serverId: null,
				environmentId: "e1",
			},
		];
		docker.services = [service("s1", "shop"), service("s2", "api")];
		docker.tasks = [task("s1", "running"), task("s2", "running")];

		const corrections = await reconcileServiceStatuses();

		expect(docker.listServicesCalls).toBe(1);
		expect(docker.listTasksCalls).toBe(1);
		expect(corrections.map((c) => [c.appName, c.to])).toEqual([
			["shop", "running"],
			["api", "running"],
			["gone", "idle"],
		]);
		expect(updates.filter((u) => u.table === "application")).toHaveLength(3);
	});

	it("answers compose stacks from the same snapshot instead of shelling out", async () => {
		rows.compose = [
			{
				composeId: "c1",
				appName: "blog",
				composeType: "stack",
				status: "idle",
				serverId: null,
				environmentId: "e1",
			},
		];
		docker.services = [service("s1", "blog_web", { "com.docker.stack.namespace": "blog" })];
		docker.tasks = [task("s1", "running")];

		const corrections = await reconcileServiceStatuses();

		expect(corrections).toEqual([
			expect.objectContaining({ kind: "compose", appName: "blog", to: "running" }),
		]);
		// No `docker service ls` / per-service inspect shell-outs any more.
		expect(shell.commands).toEqual([]);
	});

	it("still probes plain compose rows per server, grouped", async () => {
		rows.compose = [
			{
				composeId: "c1",
				appName: "plain-a",
				composeType: "docker-compose",
				status: "idle",
				serverId: null,
				environmentId: "e1",
			},
			{
				composeId: "c2",
				appName: "plain-b",
				composeType: "docker-compose",
				status: "idle",
				serverId: "srv-1",
				environmentId: "e1",
			},
		];
		shell.out = "running Up 2 minutes";

		const corrections = await reconcileServiceStatuses();

		expect(corrections.map((c) => c.appName).sort()).toEqual(["plain-a", "plain-b"]);
		// One combined `docker ps` command per row (both label filters in one shell).
		expect(shell.commands).toHaveLength(2);
	});

	it("leaves swarm-backed rows alone when the daemon is unreachable", async () => {
		docker.fail = true;
		rows.applications = [
			{
				applicationId: "a1",
				appName: "shop",
				status: "running",
				serverId: null,
				environmentId: "e1",
			},
		];
		rows.compose = [
			{
				composeId: "c1",
				appName: "blog",
				composeType: "stack",
				status: "running",
				serverId: null,
				environmentId: "e1",
			},
		];

		expect(await reconcileServiceStatuses()).toEqual([]);
		expect(updates).toEqual([]);
	});
});
