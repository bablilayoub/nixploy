import { describe, expect, it } from "vitest";
import {
	DEFAULT_WORKER_PORT,
	describeProcessRole,
	isPanelRole,
	isSplitRole,
	isUnknownProcessRole,
	isWorkerRole,
	PROCESS_ROLES,
	parseProcessRole,
	processRole,
} from "./role";

const env = (value?: string): NodeJS.ProcessEnv =>
	value === undefined ? {} : { NIXPLOY_ROLE: value };

describe("parseProcessRole", () => {
	it("defaults to all when unset or empty", () => {
		expect(parseProcessRole(undefined)).toBe("all");
		expect(parseProcessRole(null)).toBe("all");
		expect(parseProcessRole("")).toBe("all");
		expect(parseProcessRole("   ")).toBe("all");
	});

	it("accepts every declared role, case- and space-insensitively", () => {
		for (const role of PROCESS_ROLES) {
			expect(parseProcessRole(role)).toBe(role);
			expect(parseProcessRole(role.toUpperCase())).toBe(role);
			expect(parseProcessRole(` ${role} `)).toBe(role);
		}
	});

	it("falls back to all for an unknown value instead of throwing", () => {
		// A typo in a Swarm env var must not take the panel down.
		expect(parseProcessRole("panell")).toBe("all");
		expect(parseProcessRole("PANEL_WORKER")).toBe("all");
	});

	it("reports an unknown value so the caller can warn once", () => {
		expect(isUnknownProcessRole("panell")).toBe(true);
		expect(isUnknownProcessRole("panel")).toBe(false);
		expect(isUnknownProcessRole(undefined)).toBe(false);
		expect(isUnknownProcessRole("")).toBe(false);
	});
});

describe("role predicates", () => {
	it("treats `all` as both halves — the default install is unchanged", () => {
		expect(processRole(env())).toBe("all");
		expect(isPanelRole(env())).toBe(true);
		expect(isWorkerRole(env())).toBe(true);
		expect(isSplitRole(env())).toBe(false);
	});

	it("gives the panel the request surfaces and no background work", () => {
		expect(isPanelRole(env("panel"))).toBe(true);
		expect(isWorkerRole(env("panel"))).toBe(false);
		expect(isSplitRole(env("panel"))).toBe(true);
	});

	it("gives the worker the background work and no request surface", () => {
		expect(isPanelRole(env("worker"))).toBe(false);
		expect(isWorkerRole(env("worker"))).toBe(true);
		expect(isSplitRole(env("worker"))).toBe(true);
	});

	it("keeps every responsibility owned by exactly one side of a split", () => {
		// Nothing may be unowned (both false) or doubly owned in a split.
		for (const role of ["panel", "worker"] as const) {
			expect(isPanelRole(env(role)) !== isWorkerRole(env(role))).toBe(true);
		}
	});

	it("describes the role for boot logs", () => {
		expect(describeProcessRole("worker")).toContain("deploy queue");
		expect(describeProcessRole("panel")).toContain("nixploy-worker");
		expect(describeProcessRole("all")).toContain("single process");
	});

	it("defaults the worker's health listener to 3001", () => {
		expect(DEFAULT_WORKER_PORT).toBe(3001);
	});
});
