import { describe, expect, it } from "vitest";
import { emptyServiceStatusCounts, mergeServiceStatusRows } from "./index";

describe("mergeServiceStatusRows", () => {
	it("returns zeros for no rows", () => {
		expect(mergeServiceStatusRows()).toEqual({
			idle: 0,
			running: 0,
			done: 0,
			error: 0,
			total: 0,
		});
	});

	it("sums counts per status within one table", () => {
		expect(
			mergeServiceStatusRows([
				{ status: "running", value: 2 },
				{ status: "error", value: 1 },
			]),
		).toEqual({ idle: 0, running: 2, done: 0, error: 1, total: 3 });
	});

	it("merges rows across tables", () => {
		expect(
			mergeServiceStatusRows(
				[{ status: "running", value: 1 }],
				[
					{ status: "running", value: 3 },
					{ status: "idle", value: 2 },
				],
				[{ status: "done", value: 4 }],
			),
		).toEqual({ idle: 2, running: 4, done: 4, error: 0, total: 10 });
	});

	it("does not mutate the empty-counts factory result", () => {
		const empty = emptyServiceStatusCounts();
		mergeServiceStatusRows([{ status: "running", value: 5 }]);
		expect(empty).toEqual({ idle: 0, running: 0, done: 0, error: 0, total: 0 });
	});
});
