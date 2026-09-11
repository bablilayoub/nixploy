import { describe, expect, it, vi } from "vitest";

/**
 * Regression: `upsertApplicationSwarmService` (port/mount/env edits) used to
 * build `Env` from the application's own vars only and spread `undefined`
 * keys over the running spec — every project/environment-inherited variable
 * vanished from the service on the next trivial edit.
 */

vi.mock("../../db", () => ({
	db: {
		query: {
			environments: {
				findFirst: async () => ({
					environmentId: "env-1",
					env: "SHARED=from-environment\nDATABASE_URL=postgres://db/app",
					project: { env: "PROJECT_VAR=1\nSHARED=from-project" },
				}),
			},
		},
	},
}));
// Sibling modules with heavy import graphs — not under test here.
vi.mock("../preview", () => ({ deletePreviewDeployment: vi.fn() }));
vi.mock("../deployment/maintenance", () => ({ removeServiceLogs: vi.fn() }));
vi.mock("../schedules", () => ({ unregisterSchedulesForService: vi.fn() }));
vi.mock("../backups/scheduler", () => ({ unregisterBackupsForService: vi.fn() }));

import { buildApplicationSwarmSpec, loadMergedApplicationEnv } from "./service";

const application = {
	applicationId: "app-1",
	appName: "myapp",
	environmentId: "env-1",
	env: "APP_ONLY=1\nSHARED=from-app",
	replicas: 2,
	command: null,
	dockerImage: null,
	memoryReservation: null,
	memoryLimit: null,
	cpuReservation: null,
	cpuLimit: null,
	healthCheckSwarm: null,
	restartPolicySwarm: null,
	placementSwarm: null,
	updateConfigSwarm: null,
	rollbackConfigSwarm: null,
	modeSwarm: null,
	labelsSwarm: null,
	networkSwarm: null,
	serverId: null,
};

describe("loadMergedApplicationEnv", () => {
	it("inherits project → environment → application (deeper level wins)", async () => {
		const env = await loadMergedApplicationEnv(application);
		expect(env).toEqual([
			"PROJECT_VAR=1",
			"SHARED=from-app",
			"DATABASE_URL=postgres://db/app",
			"APP_ONLY=1",
		]);
	});
});

describe("buildApplicationSwarmSpec", () => {
	const netOptions = { environmentNetwork: "production-abc12345-net", routed: false };
	const wire = (env: string[]) =>
		JSON.parse(
			JSON.stringify(
				buildApplicationSwarmSpec(application, [], [], "myapp:latest", env, netOptions),
			),
		);

	it("puts the merged env on the container spec", () => {
		const spec = wire(["PROJECT_VAR=1", "DATABASE_URL=postgres://db/app"]);
		expect(spec.TaskTemplate.ContainerSpec.Env).toEqual([
			"PROJECT_VAR=1",
			"DATABASE_URL=postgres://db/app",
		]);
		expect(spec.TaskTemplate.ContainerSpec.Image).toBe("myapp:latest");
		expect(spec.Mode).toEqual({ Replicated: { Replicas: 2 } });
	});

	it("pins the task to the server's swarm node when one is given", () => {
		const pinned = JSON.parse(
			JSON.stringify(
				buildApplicationSwarmSpec(
					{ ...application, placementSwarm: { Constraints: ["node.labels.tier==db"] } },
					[],
					[],
					"myapp:latest",
					[],
					{ ...netOptions, swarmNodeId: "node123" },
				),
			),
		);
		expect(pinned.TaskTemplate.Placement).toEqual({
			Constraints: ["node.labels.tier==db", "node.id==node123"],
		});
		// Unpinned: the user's placement (or none) passes through.
		expect(wire([]).TaskTemplate.Placement).toBeUndefined();
	});

	it("sends explicit empties so an update never inherits stale values", () => {
		// `undefined` keys vanish in JSON: the engine would keep the previous
		// env/command/healthcheck, or a spread over the current spec would
		// drop the key entirely.
		const spec = wire([]);
		const container = spec.TaskTemplate.ContainerSpec;
		expect(Object.keys(container)).toEqual(
			expect.arrayContaining(["Env", "Mounts", "Command", "HealthCheck"]),
		);
		expect(container.Env).toEqual([]);
		expect(container.Mounts).toEqual([]);
		expect(container.Command).toBeNull();
		expect(container.HealthCheck).toBeNull();
	});
});
