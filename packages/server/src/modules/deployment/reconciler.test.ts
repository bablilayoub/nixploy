import { describe, expect, it } from "vitest";
import { reconcileStatus } from "./reconciler";

describe("reconcileStatus", () => {
	it("upgrades error/idle to running when tasks are live", () => {
		expect(reconcileStatus("error", "running")).toBe("running");
		expect(reconcileStatus("idle", "running")).toBe("running");
	});

	it("keeps done and running when tasks are live", () => {
		expect(reconcileStatus("done", "running")).toBe("done");
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
