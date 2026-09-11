import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The metrics pass must cost a FIXED number of Docker calls and DB queries,
 * not a multiple of the service count (audit #3): one `listContainers` for
 * every service's container, one more for crash-looped ones, one `inArray`
 * environment→org query and one alert-rule load per pass.
 */

const { calls, rows, dockerState } = vi.hoisted(() => ({
	calls: {
		listContainers: [] as Array<Record<string, unknown>>,
		stats: [] as string[],
		environmentsFindMany: 0,
		environmentsFindFirst: 0,
		alertRuleLoads: 0,
		evaluated: [] as Array<{ appName: string; rules: number }>,
	},
	rows: { applications: [] as Array<Record<string, unknown>> },
	dockerState: { running: [] as Array<Record<string, unknown>> },
}));

let configDir = "";

vi.mock("../application/paths", () => ({ getConfigDir: () => configDir }));

vi.mock("../deployment/docker", () => ({
	getDocker: async () => ({
		listContainers: async (options: Record<string, unknown>) => {
			calls.listContainers.push(options);
			return options.all ? [] : dockerState.running;
		},
		getContainer: (id: string) => ({
			inspect: async () => ({ RestartCount: 0 }),
			stats: async () => {
				calls.stats.push(id);
				return {};
			},
		}),
	}),
}));

vi.mock("../../ws/docker-stats", () => ({
	mapDockerStats: () => ({
		cpu: 10,
		memory: { used: 100, total: 1000, percent: 10 },
		network: { rx: 1, tx: 2 },
		block: { read: 3, write: 4 },
		pids: 5,
	}),
}));

vi.mock("../notifications", () => ({ notifyEvent: async () => {} }));

vi.mock("../observability", () => ({
	requiredAlertMetrics: async () => new Set(["cpu"]),
	computeDeployFailureStreaks: async () => new Map(),
	loadEnabledAlertRules: async () => {
		calls.alertRuleLoads += 1;
		return new Map([
			[
				"application:a1",
				[{ alertRuleId: "r1", organizationId: "org-1", enabled: true, metric: "cpu" }],
			],
		]);
	},
	deployStreakKey: (service: { applicationId?: string | null; composeId?: string | null }) =>
		service.applicationId
			? `application:${service.applicationId}`
			: service.composeId
				? `compose:${service.composeId}`
				: null,
	evaluateServiceAlertRules: async (input: { appName: string; rules?: unknown[] }) => {
		calls.evaluated.push({ appName: input.appName, rules: input.rules?.length ?? -1 });
	},
}));

vi.mock("../../db", () => {
	const empty = { findMany: async () => [] };
	return {
		db: {
			select: () => ({ from: () => ({ limit: async () => [] }) }),
			query: {
				applications: { findMany: async () => rows.applications },
				compose: empty,
				postgres: empty,
				mysql: empty,
				mariadb: empty,
				mongo: empty,
				redis: empty,
				servers: empty,
				environments: {
					findMany: async () => {
						calls.environmentsFindMany += 1;
						return [
							{
								environmentId: "env-1",
								project: { organizationId: "org-1", projectId: "proj-1" },
							},
						];
					},
					findFirst: async () => {
						calls.environmentsFindFirst += 1;
						return null;
					},
				},
			},
		},
	};
});

import { sampleAllServices } from "./history";

const application = (index: number) => ({
	applicationId: index === 1 ? "a1" : `a${index}`,
	appName: `svc-${index}`,
	serverId: null,
	environmentId: "env-1",
});

const container = (appName: string) => ({
	Id: `container-${appName}`,
	Labels: { "com.docker.swarm.service.name": appName },
});

beforeEach(async () => {
	configDir = await mkdtemp(join(tmpdir(), "nixploy-history-"));
	calls.listContainers = [];
	calls.stats = [];
	calls.environmentsFindMany = 0;
	calls.environmentsFindFirst = 0;
	calls.alertRuleLoads = 0;
	calls.evaluated = [];
	rows.applications = [];
	dockerState.running = [];
});

describe("sampleAllServices batching", () => {
	it("resolves 10 services with a single listContainers call", async () => {
		rows.applications = Array.from({ length: 10 }, (_, index) => application(index + 1));
		dockerState.running = rows.applications.map((row) => container(row.appName as string));

		await sampleAllServices();

		// One `{ all: false }` listing for the pass. `restarts` is not a
		// watched metric here, so the exited listing is not made at all.
		expect(calls.listContainers).toEqual([{ all: false }]);
		expect(calls.stats).toHaveLength(10);
	});

	it("looks the organization up once per pass, not once per service", async () => {
		rows.applications = Array.from({ length: 10 }, (_, index) => application(index + 1));
		dockerState.running = rows.applications.map((row) => container(row.appName as string));

		await sampleAllServices();

		expect(calls.environmentsFindMany).toBe(1);
		expect(calls.environmentsFindFirst).toBe(0);
		expect(calls.alertRuleLoads).toBe(1);
	});

	it("hands pre-loaded rules to the evaluator and skips services with none", async () => {
		rows.applications = [application(1), application(2)];
		dockerState.running = rows.applications.map((row) => container(row.appName as string));

		await sampleAllServices();

		// Only svc-1 (applicationId a1) has a rule; svc-2 never reaches the
		// evaluator, so it costs no query at all.
		expect(calls.evaluated).toEqual([{ appName: "svc-1", rules: 1 }]);
	});

	it("appends one JSONL line per sampled service", async () => {
		rows.applications = [application(1)];
		dockerState.running = [container("svc-1")];

		await sampleAllServices();
		await sampleAllServices();

		const file = join(configDir, "metrics", "svc-1.jsonl");
		const points = (await readFile(file, "utf8")).split("\n").filter(Boolean);
		expect(points).toHaveLength(2);
		expect(JSON.parse(points[0] as string)).toMatchObject({ cpu: 10, mu: 100, mt: 1000 });
	});

	it("makes no Docker call at all when there is nothing local to sample", async () => {
		await sampleAllServices();
		expect(calls.listContainers).toEqual([]);
	});
});
