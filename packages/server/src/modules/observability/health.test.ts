import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the injected probes run in these tests; the real ones (and their
// imports: db pool, dockerode, docker CLI) are mocked away.
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../utils/exec", () => ({ execAsync: vi.fn() }));
vi.mock("../deployment/docker", () => ({ getDocker: vi.fn() }));
vi.mock("../deployment/queue", () => ({ queueDepth: () => ({ pending: 0, running: 0 }) }));
vi.mock("../updates/check", () => ({ getAppVersion: () => "9.9.9" }));

import {
	CHECK_TIMEOUT_MS,
	checkReadiness,
	getVersionInfo,
	migrationsDirCandidates,
	READINESS_CACHE_MS,
	type ReadinessProbes,
	resetReadinessCache,
	runReadinessChecks,
	traefikRequired,
} from "./health";

const healthyProbes = (): ReadinessProbes => ({
	pingDatabase: vi.fn(async () => {}),
	pingDocker: vi.fn(async () => {}),
	readMigrations: vi.fn(async () => ({ state: "current" as const, applied: 19, expected: 19 })),
	readQueue: vi.fn(async () => ({ pending: 0, running: 0, stuck: 0 })),
	traefikPresent: vi.fn(async () => true),
	traefikRequired: () => true,
	readPlatformAlerts: vi.fn(async () => ({ evaluatedAt: null, alerts: [] })),
});

describe("runReadinessChecks", () => {
	it("reports ok when every probe passes", async () => {
		const report = await runReadinessChecks(healthyProbes());
		expect(report.ok).toBe(true);
		expect(report.failing).toEqual([]);
		expect(report.checks.database.ok).toBe(true);
		expect(report.checks.migrations).toMatchObject({ state: "current", applied: 19, expected: 19 });
		expect(report.checks.traefik).toMatchObject({ ok: true, required: true, present: true });
		expect(typeof report.checks.database.latencyMs).toBe("number");
	});

	it("fails on a database error and exposes only the message", async () => {
		const probes = healthyProbes();
		const error = new Error("connection refused");
		error.stack = "SECRET STACK postgres://user:pass@host/db";
		probes.pingDatabase = async () => {
			throw error;
		};
		const report = await runReadinessChecks(probes);
		expect(report.ok).toBe(false);
		expect(report.failing).toEqual(["database"]);
		expect(report.checks.database).toEqual({
			ok: false,
			latencyMs: expect.any(Number),
			error: "connection refused",
		});
		expect(JSON.stringify(report)).not.toContain("SECRET STACK");
	});

	it("fails on a docker error", async () => {
		const probes = healthyProbes();
		probes.pingDocker = async () => {
			throw new Error("ENOENT /var/run/docker.sock");
		};
		const report = await runReadinessChecks(probes);
		expect(report.failing).toEqual(["docker"]);
	});

	it("migrations: behind fails, ahead and unknown only warn", async () => {
		const probes = healthyProbes();
		probes.readMigrations = async () => ({ state: "behind", applied: 17, expected: 19 });
		let report = await runReadinessChecks(probes);
		expect(report.failing).toEqual(["migrations"]);
		expect(report.checks.migrations.error).toContain("17/19");

		probes.readMigrations = async () => ({ state: "ahead", applied: 20, expected: 19 });
		report = await runReadinessChecks(probes);
		expect(report.ok).toBe(true);
		expect(report.checks.migrations.warning).toMatch(/newer than this build/);

		probes.readMigrations = async () => ({ state: "unknown", applied: null, expected: null });
		report = await runReadinessChecks(probes);
		expect(report.ok).toBe(true);
		expect(report.checks.migrations.warning).toMatch(/could not be determined/);
	});

	it("queue: stuck rows and a failed lookup are warnings, never failures", async () => {
		const probes = healthyProbes();
		probes.readQueue = async () => ({ pending: 2, running: 1, stuck: 1 });
		let report = await runReadinessChecks(probes);
		expect(report.ok).toBe(true);
		expect(report.checks.queue).toMatchObject({ ok: true, pending: 2, running: 1, stuck: 1 });
		expect(report.checks.queue.warning).toMatch(/1 deployment\(s\)/);

		probes.readQueue = async () => {
			throw new Error("db gone");
		};
		report = await runReadinessChecks(probes);
		expect(report.ok).toBe(true);
		expect(report.checks.queue).toMatchObject({ ok: true, pending: 0, running: 0, stuck: 0 });
		expect(report.checks.queue.warning).toContain("db gone");
		expect(report.checks.queue.error).toBeUndefined();
	});

	it("traefik: absence fails only when the panel owns the proxy", async () => {
		const probes = healthyProbes();
		probes.traefikPresent = async () => false;
		let report = await runReadinessChecks(probes);
		expect(report.failing).toEqual(["traefik"]);
		expect(report.checks.traefik).toMatchObject({ required: true, present: false });

		probes.traefikRequired = () => false;
		report = await runReadinessChecks(probes);
		expect(report.ok).toBe(true);
		expect(report.checks.traefik).toMatchObject({ ok: true, required: false, present: false });
		expect(report.checks.traefik.warning).toMatch(/not found/);
	});

	it("traefik: a failed probe is a warning when not required, a failure when required", async () => {
		const probes = healthyProbes();
		probes.traefikPresent = async () => {
			throw new Error("docker: command not found");
		};
		probes.traefikRequired = () => false;
		let report = await runReadinessChecks(probes);
		expect(report.ok).toBe(true);
		expect(report.checks.traefik.warning).toContain("command not found");
		expect(report.checks.traefik.present).toBeNull();

		probes.traefikRequired = () => true;
		report = await runReadinessChecks(probes);
		expect(report.failing).toEqual(["traefik"]);
	});

	it("platform: self-alerts are reported as a warning, never a failure", async () => {
		const probes = healthyProbes();
		probes.readPlatformAlerts = async () => ({
			evaluatedAt: "2026-09-11T12:00:00.000Z",
			alerts: [
				{ kind: "hostDisk", severity: "critical", summary: "Disk usage is 97.0%." },
				{ kind: "certExpiry", severity: "warning", summary: "app.test expires in 3 days." },
			],
		});
		const report = await runReadinessChecks(probes);
		// A full disk must not make Swarm restart a panel that still serves.
		expect(report.ok).toBe(true);
		expect(report.failing).toEqual([]);
		expect(report.checks.platform.ok).toBe(true);
		expect(report.checks.platform.warning).toBe(
			"2 platform alert(s) active (1 critical): hostDisk, certExpiry",
		);
		expect(report.checks.platform.alerts).toHaveLength(2);
		expect(report.checks.platform.evaluatedAt).toBe("2026-09-11T12:00:00.000Z");
	});

	it("platform: a quiet or never-run cron produces no warning", async () => {
		const report = await runReadinessChecks(healthyProbes());
		expect(report.checks.platform).toMatchObject({ ok: true, evaluatedAt: null, alerts: [] });
		expect(report.checks.platform.warning).toBeUndefined();
	});

	it("platform: an unreadable state file degrades to a warning", async () => {
		const probes = healthyProbes();
		probes.readPlatformAlerts = async () => {
			throw new Error("EACCES: permission denied");
		};
		const report = await runReadinessChecks(probes);
		expect(report.ok).toBe(true);
		expect(report.checks.platform.warning).toContain("permission denied");
		expect(report.checks.platform.error).toBeUndefined();
	});

	it("lists every failing check", async () => {
		const probes = healthyProbes();
		probes.pingDatabase = async () => {
			throw new Error("db");
		};
		probes.pingDocker = async () => {
			throw new Error("docker");
		};
		const report = await runReadinessChecks(probes);
		expect(report.failing).toEqual(["database", "docker"]);
	});

	it("bounds a hung probe by the per-check timeout", async () => {
		vi.useFakeTimers();
		try {
			const probes = healthyProbes();
			probes.pingDocker = () => new Promise<void>(() => {});
			const pending = runReadinessChecks(probes);
			await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 1);
			const report = await pending;
			expect(report.failing).toEqual(["docker"]);
			expect(report.checks.docker.error).toMatch(/timed out/);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("checkReadiness cache", () => {
	beforeEach(() => {
		resetReadinessCache();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shares one pass across callers inside the cache window", async () => {
		vi.useFakeTimers();
		const probes = healthyProbes();
		const [a, b] = await Promise.all([checkReadiness({ probes }), checkReadiness({ probes })]);
		expect(a).toBe(b);
		expect(probes.pingDatabase).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(READINESS_CACHE_MS - 1);
		await checkReadiness({ probes });
		expect(probes.pingDatabase).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(2);
		await checkReadiness({ probes });
		expect(probes.pingDatabase).toHaveBeenCalledTimes(2);
	});

	it("force bypasses the cache", async () => {
		const probes = healthyProbes();
		await checkReadiness({ probes });
		await checkReadiness({ probes, force: true });
		expect(probes.pingDatabase).toHaveBeenCalledTimes(2);
	});
});

describe("traefikRequired", () => {
	it("is true only when NIXPLOY_DISABLE_TRAEFIK_BOOT is unset", () => {
		expect(traefikRequired({})).toBe(true);
		expect(traefikRequired({ NIXPLOY_DISABLE_TRAEFIK_BOOT: "1" })).toBe(false);
	});
});

describe("migrationsDirCandidates", () => {
	it("prefers NIXPLOY_MIGRATIONS_DIR and always includes the image path", () => {
		const candidates = migrationsDirCandidates({ NIXPLOY_MIGRATIONS_DIR: "/custom/drizzle" });
		expect(candidates[0]).toBe("/custom/drizzle");
		expect(candidates).toContain("/app/packages/server/drizzle");
		expect(migrationsDirCandidates({})[0]).not.toBe("/custom/drizzle");
	});
});

describe("getVersionInfo", () => {
	it("omits the commit when it is not baked in", () => {
		expect(getVersionInfo({})).toEqual({ version: "9.9.9", node: process.versions.node });
		expect(getVersionInfo({ NIXPLOY_GIT_COMMIT: " abc123 " })).toMatchObject({ commit: "abc123" });
	});
});
