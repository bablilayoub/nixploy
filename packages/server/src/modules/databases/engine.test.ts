import { describe, expect, it } from "vitest";
import { type ServiceState, statusFromServiceState, summarizeTaskStates } from "./engine";

const state = (partial: Partial<ServiceState>): ServiceState => ({
	exists: true,
	desired: 1,
	running: 0,
	pending: 0,
	failed: 0,
	...partial,
});

describe("summarizeTaskStates", () => {
	it("counts running, pending and failed tasks", () => {
		expect(summarizeTaskStates(["running", "starting", "pending", "failed", "rejected"])).toEqual({
			running: 1,
			pending: 2,
			failed: 2,
		});
	});

	it("ignores normal lifecycle states (shutdown/complete)", () => {
		expect(summarizeTaskStates(["shutdown", "complete", "running"])).toEqual({
			running: 1,
			pending: 0,
			failed: 0,
		});
	});

	it("handles unknown states by ignoring them", () => {
		expect(summarizeTaskStates(["", "orphaned"])).toEqual({
			running: 0,
			pending: 0,
			failed: 0,
		});
	});
});

describe("statusFromServiceState", () => {
	it("is idle when the service does not exist", () => {
		expect(statusFromServiceState(state({ exists: false }))).toBe("idle");
	});

	it("is idle when scaled to zero", () => {
		expect(statusFromServiceState(state({ desired: 0 }))).toBe("idle");
	});

	it("is running when at least one task is up", () => {
		expect(statusFromServiceState(state({ running: 1 }))).toBe("running");
		// Old task failures don't matter once the service recovered.
		expect(statusFromServiceState(state({ running: 1, failed: 3 }))).toBe("running");
	});

	it("is running while tasks are still being placed or started", () => {
		expect(statusFromServiceState(state({ pending: 1 }))).toBe("running");
		// Just created: desired > 0 but no tasks scheduled yet.
		expect(statusFromServiceState(state({}))).toBe("running");
	});

	it("is error when tasks crash-loop (repeated failures)", () => {
		expect(statusFromServiceState(state({ failed: 2, pending: 1 }))).toBe("error");
	});

	it("is error after a single failure with no retry in flight", () => {
		expect(statusFromServiceState(state({ failed: 1, pending: 0 }))).toBe("error");
	});

	it("is running during the first retry after a single failure", () => {
		expect(statusFromServiceState(state({ failed: 1, pending: 1 }))).toBe("running");
	});
});
