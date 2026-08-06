import { describe, expect, it } from "vitest";
import { mergeDeploymentStatusRows } from "./queries";

describe("mergeDeploymentStatusRows", () => {
	it("returns zeros for no rows", () => {
		expect(mergeDeploymentStatusRows([])).toEqual({
			running: 0,
			done: 0,
			error: 0,
			cancelled: 0,
			total: 0,
		});
	});

	it("sums counts per status and tracks the total", () => {
		expect(
			mergeDeploymentStatusRows([
				{ status: "done", value: 7 },
				{ status: "error", value: 2 },
				{ status: "running", value: 1 },
			]),
		).toEqual({ running: 1, done: 7, error: 2, cancelled: 0, total: 10 });
	});
});
