import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the deploy worker's status bookkeeping:
 * - a failed preview must set previewDeployments.previewStatus = "error"
 *   (before the fix it stayed "running" forever);
 * - a cancelled preview must set it back to "idle";
 * - preview jobs must never touch the PARENT application's status;
 * - a failure BEFORE the log is opened (DB error, unwritable log dir) must
 *   still finalize the row and emit `finish`;
 * - a job stuck in a step that is not process-bound still finalizes when it
 *   hits its deadline, is cancelled by the user, or interrupted by shutdown.
 */

const {
	updates,
	deploymentRow,
	applicationLookup,
	composeLookup,
	composePipeline,
	hooks,
	pipeline,
} = vi.hoisted(() => ({
	updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
	deploymentRow: {
		value: null as null | { deploymentId: string; status: string; logPath: string },
		/** Thrown once by the next deployments.findFirst call. */
		error: null as null | Error,
	},
	/**
	 * `hang`: applications.findFirst never resolves (a hung DB/SSH step).
	 * `row`: the application the pipeline should see; null → the job fails fast.
	 */
	applicationLookup: { hang: false, row: null as null | Record<string, unknown> },
	/**
	 * The compose pipeline's two rows: the compose service and, for a preview
	 * job, the `preview_deployment` row the worker must fork the project from.
	 */
	composeLookup: {
		row: null as null | Record<string, unknown>,
		preview: null as null | Record<string, unknown>,
	},
	/** Compose-side doubles: what the worker hands the compose module. */
	composePipeline: {
		prepareComposeFiles: vi.fn(async () => ({
			workDir: "/tmp/work",
			composeFilePath: "/tmp/work/docker-compose.nixploy.yml",
			envFilePath: "/tmp/work/.env",
			secrets: [] as string[],
		})),
		buildComposeDeployCommand: vi.fn(() => "true"),
		resyncComposeDomains: vi.fn(async () => {}),
		syncPreviewTraefik: vi.fn(async () => {}),
		spawnTargeted: vi.fn(async () => ({ done: Promise.resolve(), kill: () => {} })),
	},
	/** Deploy-hook doubles, so a hook can be made to fail on demand. */
	hooks: {
		runPreDeployHook: vi.fn(async () => {}),
		runPostDeployHook: vi.fn(async () => {}),
		runComposeExecHook: vi.fn(async () => {}),
	},
	/** Everything the application pipeline touches between source and rollout. */
	pipeline: {
		buildImage: vi.fn(async () => "app:latest"),
		upsertSwarmService: vi.fn(async () => {}),
		waitForServiceConvergence: vi.fn(async () => {}),
	},
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			deployments: {
				findFirst: async () => {
					if (deploymentRow.error) {
						const error = deploymentRow.error;
						deploymentRow.error = null;
						throw error;
					}
					return deploymentRow.value;
				},
			},
			// No application row → the job fails fast, exercising the catch path.
			applications: {
				findFirst: () =>
					applicationLookup.hang
						? new Promise<never>(() => {})
						: Promise.resolve(applicationLookup.row ?? undefined),
			},
			previewDeployments: { findFirst: async () => composeLookup.preview },
			compose: { findFirst: async () => composeLookup.row ?? undefined },
		},
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => {
				const name =
					(table as Record<PropertyKey, unknown>)[Symbol.for("drizzle:Name")] ?? "unknown";
				updates.push({ table: String(name), values });
				return { where: async () => [] as unknown[] };
			},
		}),
	},
}));

vi.mock("./logger", () => ({
	DeploymentLogger: class {
		constructor(readonly logPath: string) {}
		addSecret(): void {}
		listSecrets(): readonly string[] {
			return [];
		}
		write(): void {}
		line(): void {}
		close(): void {}
	},
}));

// Owned by another module — stub so the test does not depend on it.
vi.mock("../compose/service", () => ({
	prepareComposeFiles: composePipeline.prepareComposeFiles,
	buildComposeDeployCommand: composePipeline.buildComposeDeployCommand,
	resyncComposeDomains: composePipeline.resyncComposeDomains,
	runsOnPrimary: (row: { composeType: string }) => row.composeType === "stack",
}));
vi.mock("../preview/traefik", () => ({ syncPreviewTraefik: composePipeline.syncPreviewTraefik }));
// `ctx.run` would otherwise spawn a real child process for the compose job.
vi.mock("./docker", async (importOriginal) => ({
	...(await importOriginal<typeof import("./docker")>()),
	spawnTargeted: composePipeline.spawnTargeted,
}));

// Pipeline doubles: the hook tests below care about ORDER (hook before
// rollout), not about docker actually running anything.
vi.mock("./hooks", async (importOriginal) => ({
	...(await importOriginal<typeof import("./hooks")>()),
	runPreDeployHook: hooks.runPreDeployHook,
	runPostDeployHook: hooks.runPostDeployHook,
	runComposeExecHook: hooks.runComposeExecHook,
}));
vi.mock("./builders", () => ({ buildImage: pipeline.buildImage }));
vi.mock("./swarm", () => ({
	upsertSwarmService: pipeline.upsertSwarmService,
	waitForServiceConvergence: pipeline.waitForServiceConvergence,
}));
vi.mock("./network", () => ({ ensureEnvironmentNetwork: vi.fn(async () => "env-net") }));
vi.mock("./sources", () => ({
	cloneGitSource: vi.fn(async () => "/tmp/code"),
	extractDropSource: vi.fn(async () => "/tmp/code"),
	pullDockerImage: vi.fn(async () => "nginx:latest"),
	readCheckoutCommit: vi.fn(async () => null),
	resolveImageDigest: vi.fn(async () => null),
	resolveRegistryAuth: vi.fn(async () => null),
}));
vi.mock("./push", () => ({
	pushBuiltImage: vi.fn(async () => "ghcr.io/acme/app:dep"),
	resolvePushRegistry: vi.fn(async () => null),
}));
vi.mock("./rollback", () => ({
	pinRollbackImage: vi.fn(async () => "app:dep"),
	recordRollback: vi.fn(async () => {}),
}));
vi.mock("../traefik/config-writer", () => ({
	writeAppTraefikConfig: vi.fn(async () => {}),
	DEFAULT_CONTAINER_PORT: 80,
}));

import type { QueueJob } from "./queue";
import type { ApplicationRow } from "./sources";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Let a whole pipeline (several awaits deep) run to its terminal update. */
const settle = async () => {
	for (let i = 0; i < 12; i++) await flush();
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const job = (deploymentId: string, previewDeploymentId: string): QueueJob => ({
	deploymentId,
	appName: "parent-app",
	applicationId: "parent-app-1",
	previewDeploymentId,
	type: "deploy",
	serverId: null,
});

const terminalUpdate = () => updates.find((u) => u.table === "deployment" && "status" in u.values);

describe("worker preview status bookkeeping", () => {
	beforeEach(async () => {
		vi.resetModules();
		delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
		updates.length = 0;
		deploymentRow.error = null;
		applicationLookup.hang = false;
		applicationLookup.row = null;
		deploymentRow.value = { deploymentId: "d1", status: "running", logPath: "/tmp/test.log" };
	});

	it("does not re-write the status the claim query already set", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-claim", status: "running", logPath: "/tmp/c.log" };
		queue.startJob("__local__", job("d-claim", "prev-0"));
		await flush();
		await flush();

		// The row arrives already `running` (claimed atomically in SQL); the
		// worker only writes the TERMINAL status.
		const statusUpdates = updates
			.filter((u) => u.table === "deployment" && "status" in u.values)
			.map((u) => u.values.status);
		expect(statusUpdates).toEqual(["error"]);
	});

	it("skips a row that is no longer running (cancelled or superseded while waiting)", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-gone", status: "cancelled", logPath: "/tmp/g.log" };
		queue.startJob("__local__", job("d-gone", "prev-0"));
		await flush();
		await flush();

		expect(updates).toEqual([]);
	});

	it("marks a failed preview as error and leaves the parent app untouched", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-fail", status: "running", logPath: "/tmp/f.log" };
		queue.startJob("__local__", job("d-fail", "prev-1"));
		await flush();
		await flush();

		const previewUpdates = updates.filter((u) => u.table === "preview_deployment");
		expect(previewUpdates).toContainEqual({
			table: "preview_deployment",
			values: { previewStatus: "error" },
		});

		// The parent application row must never be updated for preview jobs.
		expect(updates.filter((u) => u.table === "application")).toEqual([]);

		const terminal = terminalUpdate();
		expect(terminal?.values.status).toBe("error");
	});

	it("marks a cancelled preview as idle and leaves the parent app untouched", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-cancel", status: "running", logPath: "/tmp/c.log" };
		queue.startJob("__local__", job("d-cancel", "prev-2"));
		// The drain loop marks the job running synchronously, so this cancels it.
		queue.requestCancellation("d-cancel");
		await flush();
		await flush();

		const previewUpdates = updates.filter((u) => u.table === "preview_deployment");
		expect(previewUpdates).toContainEqual({
			table: "preview_deployment",
			values: { previewStatus: "idle" },
		});
		expect(updates.filter((u) => u.table === "application")).toEqual([]);

		const terminal = terminalUpdate();
		expect(terminal?.values.status).toBe("cancelled");
	});

	it("finalizes the row and emits finish when the job dies before its log opens", async () => {
		const queue = await import("./queue");
		await import("./worker");
		const { deploymentEvents } = await import("./events");
		const finished: Array<{ deploymentId: string; status: string }> = [];
		const onFinish = (event: { deploymentId: string; status: string }) => {
			finished.push(event);
		};
		deploymentEvents.on("finish", onFinish);
		try {
			deploymentRow.error = new Error("database unavailable");
			queue.startJob("__local__", {
				deploymentId: "d-early",
				appName: "app-one",
				applicationId: "app-1",
				type: "deploy",
				serverId: null,
			});
			await flush();
			await flush();

			const terminal = terminalUpdate();
			expect(terminal?.values.status).toBe("error");
			expect(terminal?.values.errorMessage).toBe("database unavailable");
			expect(finished).toContainEqual({ deploymentId: "d-early", status: "error" });
			// A non-preview job failing marks the application as errored.
			expect(updates.filter((u) => u.table === "application").at(-1)?.values).toEqual({
				status: "error",
			});
		} finally {
			deploymentEvents.off("finish", onFinish);
		}
	});
});

describe("worker deadlines and interruption", () => {
	const hungJob = (deploymentId: string): QueueJob => ({
		deploymentId,
		appName: "hung-app",
		applicationId: "app-hung",
		type: "deploy",
		serverId: null,
	});

	beforeEach(async () => {
		vi.resetModules();
		delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
		updates.length = 0;
		deploymentRow.error = null;
		applicationLookup.hang = true;
		delete process.env.NIXPLOY_DEPLOY_TIMEOUT_MS;
	});

	it("fails a job that exceeds NIXPLOY_DEPLOY_TIMEOUT_MS even while stuck in a non-process await", async () => {
		process.env.NIXPLOY_DEPLOY_TIMEOUT_MS = "40";
		const queue = await import("./queue");
		await import("./worker");
		const { deploymentEvents } = await import("./events");
		const finished: Array<{ deploymentId: string; status: string }> = [];
		const onFinish = (event: { deploymentId: string; status: string }) => {
			finished.push(event);
		};
		deploymentEvents.on("finish", onFinish);
		try {
			deploymentRow.value = { deploymentId: "d-slow", status: "running", logPath: "/tmp/s.log" };
			queue.startJob("__local__", hungJob("d-slow"));
			await sleep(150);

			const terminal = terminalUpdate();
			expect(terminal?.values.status).toBe("error");
			expect(terminal?.values.errorMessage).toMatch(/^Deployment exceeded /);
			expect(finished).toContainEqual({ deploymentId: "d-slow", status: "error" });
			// The slot is free again: the queue does not think the job is still running.
			expect(queue.queueDepth(null)).toEqual({ pending: 0, running: 0 });
		} finally {
			deploymentEvents.off("finish", onFinish);
			delete process.env.NIXPLOY_DEPLOY_TIMEOUT_MS;
		}
	});

	it("finalizes a hung job as error 'Interrupted by panel shutdown' when drained", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-shut", status: "running", logPath: "/tmp/sh.log" };
		queue.startJob("__local__", hungJob("d-shut"));
		await flush();

		const result = await queue.drainQueue({ graceMs: 20 });
		expect(result).toEqual({ completed: 0, interrupted: 1 });
		const terminal = terminalUpdate();
		expect(terminal?.values).toMatchObject({
			status: "error",
			errorMessage: "Interrupted by panel shutdown",
		});
		expect(updates.filter((u) => u.table === "application").at(-1)?.values).toEqual({
			status: "error",
		});
	});

	it("finalizes a hung job as cancelled on a user cancel", async () => {
		const queue = await import("./queue");
		await import("./worker");

		deploymentRow.value = { deploymentId: "d-user", status: "running", logPath: "/tmp/u.log" };
		queue.startJob("__local__", hungJob("d-user"));
		await flush();
		expect(queue.requestCancellation("d-user")).toBe("running");
		await flush();
		await flush();

		const terminal = terminalUpdate();
		expect(terminal?.values).toMatchObject({ status: "cancelled", errorMessage: null });
		expect(updates.filter((u) => u.table === "application").at(-1)?.values).toEqual({
			status: "idle",
		});
	});
});

describe("buildPreviewDeployTarget", () => {
	const application = {
		appName: "myapp",
		owner: "acme",
		repository: "app",
		branch: "main",
		gitBranch: null,
	} as unknown as ApplicationRow;

	it("keeps the parent repo for same-repo PRs and fetches PR refs for forks", async () => {
		const { buildPreviewDeployTarget } = await import("./worker");
		expect(
			buildPreviewDeployTarget(application, { appName: "myapp-pr-3", branch: "feat" }),
		).toMatchObject({
			appName: "myapp-pr-3",
			owner: "acme",
			repository: "app",
			branch: "feat",
			gitBranch: "feat",
		});
		expect(
			buildPreviewDeployTarget(application, { appName: "myapp-pr-3", branch: "refs/pull/3/head" }),
		).toMatchObject({ owner: "acme", repository: "app", branch: "refs/pull/3/head" });
	});

	it("clones the fork repository for Bitbucket fork PRs", async () => {
		const { buildPreviewDeployTarget } = await import("./worker");
		expect(
			buildPreviewDeployTarget(application, {
				appName: "myapp-pr-3",
				branch: "fork:forker/app:fix",
			}),
		).toMatchObject({ owner: "forker", repository: "app", branch: "fix", gitBranch: "fix" });
	});
});

/**
 * A compose preview job must render and deploy the PREVIEW project
 * (`<app>-pr-<n>`), never production: no rollback snapshot against the parent,
 * no deploy hooks, no production Traefik resync, and no write to the compose
 * row's status.
 */
describe("compose preview jobs", () => {
	const composeRow = (overrides: Record<string, unknown> = {}) => ({
		composeId: "cmp-1",
		name: "shop",
		appName: "shop-9f00aa",
		env: "LOG_LEVEL=info",
		composeType: "docker-compose",
		sourceType: "github",
		repository: "shop",
		owner: "acme",
		branch: "main",
		gitBranch: null,
		composePath: "./compose.yaml",
		previewEnv: null,
		isolatedDeployment: false,
		suffix: "",
		preDeployCommand: "echo pre",
		postDeployCommand: "echo post",
		serverId: null,
		environmentId: "env-1",
		...overrides,
	});

	const composeJob = (deploymentId: string, previewDeploymentId?: string) => ({
		deploymentId,
		appName: previewDeploymentId ? "shop-9f00aa-pr-7" : "shop-9f00aa",
		composeId: "cmp-1",
		previewDeploymentId,
		type: "deploy" as const,
		serverId: null,
	});

	beforeEach(async () => {
		vi.resetModules();
		delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
		updates.length = 0;
		deploymentRow.error = null;
		applicationLookup.hang = false;
		applicationLookup.row = null;
		composeLookup.row = composeRow();
		composeLookup.preview = null;
		composePipeline.prepareComposeFiles.mockClear();
		composePipeline.buildComposeDeployCommand.mockClear();
		composePipeline.resyncComposeDomains.mockClear();
		composePipeline.syncPreviewTraefik.mockClear();
		hooks.runComposeExecHook.mockClear();
	});

	it("renders the preview project from the PR ref with previewEnv merged in", async () => {
		composeLookup.row = composeRow({ previewEnv: "LOG_LEVEL=debug\nPREVIEW=1" });
		composeLookup.preview = {
			previewDeploymentId: "prev-7",
			appName: "shop-9f00aa-pr-7",
			branch: "refs/pull/7/head",
			composeId: "cmp-1",
			applicationId: null,
		};
		deploymentRow.value = { deploymentId: "d-cp", status: "running", logPath: "/tmp/cp.log" };

		const queue = await import("./queue");
		await import("./worker");
		queue.startJob("__local__", composeJob("d-cp", "prev-7"));
		await settle();

		const [target, options] = (composePipeline.prepareComposeFiles.mock.calls[0] ??
			[]) as unknown as [
			{ appName: string; env: string; branch: string },
			{ deploymentId: string | null },
		];
		expect(target.appName).toBe("shop-9f00aa-pr-7");
		expect(target.branch).toBe("refs/pull/7/head");
		expect(target.env.split("\n").sort()).toEqual(["LOG_LEVEL=debug", "PREVIEW=1"]);
		// Never snapshot a preview render against the parent's rollback history.
		expect(options.deploymentId).toBeNull();
		// The deploy command runs for the preview project, not production.
		const [deployTarget] = (composePipeline.buildComposeDeployCommand.mock.calls[0] ??
			[]) as unknown as [{ appName: string }];
		expect(deployTarget.appName).toBe("shop-9f00aa-pr-7");
	});

	it("skips both deploy hooks and writes only the preview's Traefik files", async () => {
		composeLookup.preview = {
			previewDeploymentId: "prev-7",
			appName: "shop-9f00aa-pr-7",
			branch: "feature/x",
			composeId: "cmp-1",
			applicationId: null,
		};
		deploymentRow.value = { deploymentId: "d-cp2", status: "running", logPath: "/tmp/cp2.log" };

		const queue = await import("./queue");
		await import("./worker");
		queue.startJob("__local__", composeJob("d-cp2", "prev-7"));
		await settle();

		expect(hooks.runComposeExecHook).not.toHaveBeenCalled();
		expect(composePipeline.resyncComposeDomains).not.toHaveBeenCalled();
		expect(composePipeline.syncPreviewTraefik).toHaveBeenCalledWith("prev-7");
		// The preview row is marked done; the compose row's status is untouched.
		expect(updates).toContainEqual({
			table: "preview_deployment",
			values: { previewStatus: "done" },
		});
		expect(updates.filter((u) => u.table === "compose")).toEqual([]);
	});

	it("refuses a preview row that belongs to another compose service", async () => {
		composeLookup.preview = {
			previewDeploymentId: "prev-x",
			appName: "other-pr-7",
			branch: "feature/x",
			composeId: "cmp-other",
			applicationId: null,
		};
		deploymentRow.value = { deploymentId: "d-cp3", status: "running", logPath: "/tmp/cp3.log" };

		const queue = await import("./queue");
		await import("./worker");
		queue.startJob("__local__", composeJob("d-cp3", "prev-x"));
		await settle();

		const terminal = terminalUpdate();
		expect(terminal?.values.status).toBe("error");
		expect(String(terminal?.values.errorMessage)).toContain("does not belong");
		expect(composePipeline.prepareComposeFiles).not.toHaveBeenCalled();
	});

	it("still snapshots, hooks and resyncs production for a non-preview compose job", async () => {
		deploymentRow.value = { deploymentId: "d-cp4", status: "running", logPath: "/tmp/cp4.log" };

		const queue = await import("./queue");
		await import("./worker");
		queue.startJob("__local__", composeJob("d-cp4"));
		await settle();

		const [, options] = (composePipeline.prepareComposeFiles.mock.calls[0] ?? []) as unknown as [
			unknown,
			{ deploymentId: string | null },
		];
		expect(options.deploymentId).toBe("d-cp4");
		expect(hooks.runComposeExecHook).toHaveBeenCalledTimes(2);
		expect(composePipeline.resyncComposeDomains).toHaveBeenCalledWith("cmp-1");
		expect(composePipeline.syncPreviewTraefik).not.toHaveBeenCalled();
	});
});

describe("deploy hooks", () => {
	const applicationRow = (overrides: Record<string, unknown> = {}) => ({
		applicationId: "app-hooks",
		appName: "hooked-app",
		name: "Hooked",
		sourceType: "docker",
		dockerImage: "traefik/whoami:v1.10.1",
		env: null,
		buildArgs: null,
		buildPath: "/",
		buildType: "nixpacks",
		previewEnv: null,
		preDeployCommand: null,
		postDeployCommand: null,
		pushRegistryId: null,
		registryId: null,
		environmentId: "env-1",
		serverId: null,
		environment: {
			environmentId: "env-1",
			name: "production",
			env: null,
			project: { projectId: "proj-1", env: null, organizationId: "org-1" },
		},
		...overrides,
	});

	const hookJob = (deploymentId: string): QueueJob => ({
		deploymentId,
		appName: "hooked-app",
		applicationId: "app-hooks",
		type: "deploy",
		serverId: null,
	});

	beforeEach(async () => {
		vi.resetModules();
		delete (globalThis as { __nixployDeploymentQueue?: unknown }).__nixployDeploymentQueue;
		updates.length = 0;
		deploymentRow.error = null;
		applicationLookup.hang = false;
		applicationLookup.row = null;
		hooks.runPreDeployHook.mockReset().mockResolvedValue(undefined);
		hooks.runPostDeployHook.mockReset().mockResolvedValue(undefined);
		pipeline.upsertSwarmService.mockReset().mockResolvedValue(undefined);
		delete process.env.NIXPLOY_DEPLOY_TIMEOUT_MS;
	});

	it("runs the pre-deploy hook before the rollout and the post-deploy hook after it", async () => {
		applicationLookup.row = applicationRow({
			preDeployCommand: "npm run migrate",
			postDeployCommand: "npm run warm",
		});
		deploymentRow.value = { deploymentId: "d-hook", status: "running", logPath: "/tmp/h.log" };
		const queue = await import("./queue");
		await import("./worker");
		queue.startJob("__local__", hookJob("d-hook"));
		for (let i = 0; i < 8; i += 1) await flush();

		expect(hooks.runPreDeployHook).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ appName: "hooked-app", command: "npm run migrate" }),
		);
		expect(pipeline.upsertSwarmService).toHaveBeenCalled();
		expect(hooks.runPostDeployHook).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ appName: "hooked-app", command: "npm run warm" }),
		);
		expect(terminalUpdate()?.values.status).toBe("done");
	});

	it("aborts the deployment when the pre-deploy hook exits non-zero, leaving the rollout untouched", async () => {
		applicationLookup.row = applicationRow({ preDeployCommand: "exit 3" });
		hooks.runPreDeployHook.mockRejectedValue(
			new Error("Pre-deploy command failed: Command failed (exit 3)"),
		);
		deploymentRow.value = { deploymentId: "d-fail", status: "running", logPath: "/tmp/f.log" };
		const queue = await import("./queue");
		await import("./worker");
		queue.startJob("__local__", hookJob("d-fail"));
		for (let i = 0; i < 8; i += 1) await flush();

		// The previous version keeps serving: the swarm service was never touched.
		expect(pipeline.upsertSwarmService).not.toHaveBeenCalled();
		expect(hooks.runPostDeployHook).not.toHaveBeenCalled();
		const terminal = terminalUpdate();
		expect(terminal?.values.status).toBe("error");
		expect(terminal?.values.errorMessage).toContain("Pre-deploy command failed");
	});

	it("skips both hooks when the application has none configured", async () => {
		applicationLookup.row = applicationRow();
		deploymentRow.value = { deploymentId: "d-none", status: "running", logPath: "/tmp/n.log" };
		const queue = await import("./queue");
		await import("./worker");
		queue.startJob("__local__", hookJob("d-none"));
		for (let i = 0; i < 8; i += 1) await flush();

		expect(hooks.runPreDeployHook).not.toHaveBeenCalled();
		expect(hooks.runPostDeployHook).not.toHaveBeenCalled();
		expect(pipeline.upsertSwarmService).toHaveBeenCalled();
	});
});

describe("describeDeadline", () => {
	it("prints minutes for minute-scale budgets and seconds otherwise", async () => {
		const { describeDeadline } = await import("./worker");
		expect(describeDeadline(60 * 60 * 1000)).toBe("60 minutes");
		expect(describeDeadline(90 * 1000)).toBe("2 minutes");
		expect(describeDeadline(30 * 1000)).toBe("30 seconds");
		expect(describeDeadline(40)).toBe("1 seconds");
	});
});
