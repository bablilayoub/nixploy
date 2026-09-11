import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDocker } from "../../test-utils/fake-docker";
import { useTempDir } from "../../test-utils/tmpdir";

/**
 * The metrics pass must cost a FIXED number of Docker calls and DB queries,
 * not a multiple of the service count (audit #3): one `listContainers` for
 * every service's container, one more for crash-looped ones, one `inArray`
 * environment→org query and one alert-rule load per pass.
 *
 * Imported through `./history` on purpose: that barrel is what the router and
 * `apps/web/server.ts` import, so it also guards the sampler/alerts/store
 * split behind it (audit F5).
 */

const state = vi.hoisted(() => ({
	/** Set by the `../deployment/docker` mock factory below. */
	docker: null as FakeDocker | null,
	calls: {
		environmentsFindMany: 0,
		environmentsFindFirst: 0,
		alertRuleLoads: 0,
		evaluated: [] as Array<{ appName: string; rules: number }>,
	},
	applications: [] as Array<Record<string, unknown>>,
	running: [] as Array<Record<string, unknown>>,
}));

const docker = (): FakeDocker => {
	if (!state.docker) throw new Error("docker mock was never initialised");
	return state.docker;
};

const configDir = useTempDir("nixploy-history-");

vi.mock("../application/paths", () => ({ getConfigDir: () => configDir.path }));

vi.mock("../deployment/docker", async () => {
	const { createFakeDocker } = await import("../../test-utils/fake-docker");
	state.docker = createFakeDocker({
		containers: (options) => (options.all ? [] : (state.running as never[])),
		inspect: () => ({ RestartCount: 0 }),
		stats: () => ({}),
	});
	return { getDocker: async () => state.docker?.docker };
});

vi.mock("../docker/stats", () => ({
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
		state.calls.alertRuleLoads += 1;
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
		state.calls.evaluated.push({ appName: input.appName, rules: input.rules?.length ?? -1 });
	},
}));

vi.mock("../../db", () => {
	const empty = { findMany: async () => [] };
	return {
		db: {
			select: () => ({ from: () => ({ limit: async () => [] }) }),
			query: {
				applications: { findMany: async () => state.applications },
				compose: empty,
				postgres: empty,
				mysql: empty,
				mariadb: empty,
				mongo: empty,
				redis: empty,
				servers: empty,
				environments: {
					findMany: async () => {
						state.calls.environmentsFindMany += 1;
						return [
							{
								environmentId: "env-1",
								project: { organizationId: "org-1", projectId: "proj-1" },
							},
						];
					},
					findFirst: async () => {
						state.calls.environmentsFindFirst += 1;
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

/** Register `count` local applications, all of them with a running container. */
function seedRunningApplications(count: number): void {
	state.applications = Array.from({ length: count }, (_, index) => application(index + 1));
	state.running.push(...state.applications.map((row) => container(row.appName as string)));
}

beforeEach(() => {
	state.calls.environmentsFindMany = 0;
	state.calls.environmentsFindFirst = 0;
	state.calls.alertRuleLoads = 0;
	state.calls.evaluated = [];
	state.applications = [];
	state.running.length = 0;
	state.docker?.reset();
});

describe("sampleAllServices batching", () => {
	it("resolves 10 services with a single listContainers call", async () => {
		seedRunningApplications(10);

		await sampleAllServices();

		// One `{ all: false }` listing for the pass. `restarts` is not a
		// watched metric here, so the exited listing is not made at all.
		expect(docker().calls.listContainers).toEqual([{ all: false }]);
		expect(docker().calls.stats).toHaveLength(10);
	});

	it("looks the organization up once per pass, not once per service", async () => {
		seedRunningApplications(10);

		await sampleAllServices();

		expect(state.calls.environmentsFindMany).toBe(1);
		expect(state.calls.environmentsFindFirst).toBe(0);
		expect(state.calls.alertRuleLoads).toBe(1);
	});

	it("hands pre-loaded rules to the evaluator and skips services with none", async () => {
		seedRunningApplications(2);

		await sampleAllServices();

		// Only svc-1 (applicationId a1) has a rule; svc-2 never reaches the
		// evaluator, so it costs no query at all.
		expect(state.calls.evaluated).toEqual([{ appName: "svc-1", rules: 1 }]);
	});

	it("appends one JSONL line per sampled service", async () => {
		seedRunningApplications(1);

		await sampleAllServices();
		await sampleAllServices();

		const file = join(configDir.path, "metrics", "svc-1.jsonl");
		const points = (await readFile(file, "utf8")).split("\n").filter(Boolean);
		expect(points).toHaveLength(2);
		expect(JSON.parse(points[0] as string)).toMatchObject({ cpu: 10, mu: 100, mt: 1000 });
	});

	it("makes no Docker call at all when there is nothing local to sample", async () => {
		await sampleAllServices();
		expect(docker().calls.listContainers).toEqual([]);
	});
});
