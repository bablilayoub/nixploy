import { describe, expect, it } from "vitest";
import { evaluatePreflight, type PreflightInputs } from "./preflight";

const now = Date.parse("2026-09-20T10:00:00Z");
const healthy = (): PreflightInputs => ({
	currentVersion: "0.4.0",
	targetTag: "v0.4.1",
	isDowngrade: false,
	allowDowngrade: false,
	updateInProgress: false,
	disk: {
		totalBytes: 100 * 1024 ** 3,
		usedBytes: 40 * 1024 ** 3,
		availableBytes: 60 * 1024 ** 3,
		usedPercent: 40,
		path: "/etc/nixploy",
	},
	activeDeployments: 0,
	lastInstanceBackupAt: new Date(now - 24 * 60 * 60 * 1000),
	currentDigest: "sha256:aaa",
	remoteDigest: "sha256:bbb",
	registryError: null,
	release: {
		tag: "v0.4.1",
		name: null,
		notes: "Bug fixes.",
		notesTruncated: false,
		url: "https://example.com/r",
		publishedAt: null,
	},
	readiness: {
		ok: true,
		checkedAt: "",
		failing: [],
		checks: {
			database: { ok: true },
			docker: { ok: true },
			migrations: { ok: true, state: "current" },
			queue: { ok: true },
			traefik: { ok: true },
			platform: { ok: true },
		},
	} as unknown as PreflightInputs["readiness"],
});

const byId = (inputs: PreflightInputs) =>
	Object.fromEntries(evaluatePreflight(inputs, now).map((check) => [check.id, check]));

describe("update preflight", () => {
	it("is all clear on a healthy host with a resolvable, newer target", () => {
		const checks = evaluatePreflight(healthy(), now);
		expect(checks.every((check) => check.level === "ok")).toBe(true);
		expect(checks.map((check) => check.id)).toEqual([
			"in-progress",
			"registry",
			"disk",
			"deployments",
			"backup",
			"health",
			"release",
		]);
	});

	it("blocks on the things the roll cannot recover from", () => {
		expect(byId({ ...healthy(), updateInProgress: true })["in-progress"]?.level).toBe("block");
		expect(byId({ ...healthy(), remoteDigest: null }).registry?.level).toBe("block");
		expect(byId({ ...healthy(), registryError: "401" }).registry?.detail).toContain("401");
		const disk = healthy().disk as NonNullable<PreflightInputs["disk"]>;
		expect(
			byId({ ...healthy(), disk: { ...disk, availableBytes: 512 * 1024 ** 2 } }).disk?.level,
		).toBe("block");
		expect(byId({ ...healthy(), isDowngrade: true }).downgrade?.level).toBe("block");
		expect(byId({ ...healthy(), isDowngrade: true, allowDowngrade: true }).downgrade?.level).toBe(
			"warn",
		);
		const readiness = healthy().readiness as NonNullable<PreflightInputs["readiness"]>;
		expect(
			byId({ ...healthy(), readiness: { ...readiness, failing: ["database"] } }).health?.level,
		).toBe("block");
	});

	it("warns on the things an operator should weigh", () => {
		expect(byId({ ...healthy(), activeDeployments: 2 }).deployments?.level).toBe("warn");
		expect(byId({ ...healthy(), lastInstanceBackupAt: null }).backup?.level).toBe("warn");
		expect(
			byId({ ...healthy(), lastInstanceBackupAt: new Date(now - 10 * 24 * 60 * 60 * 1000) }).backup
				?.title,
		).toContain("10 days");
		expect(byId({ ...healthy(), remoteDigest: "sha256:aaa" }).registry?.level).toBe("warn");
		const release = healthy().release as NonNullable<PreflightInputs["release"]>;
		expect(
			byId({ ...healthy(), release: { ...release, notes: "BREAKING: config moved" } }).release,
		).toMatchObject({ level: "warn", url: "https://example.com/r" });
		expect(byId({ ...healthy(), release: null }).release?.level).toBe("warn");
		const readiness = healthy().readiness as NonNullable<PreflightInputs["readiness"]>;
		expect(
			byId({ ...healthy(), readiness: { ...readiness, failing: ["traefik"] } }).health?.level,
		).toBe("warn");
	});
});
