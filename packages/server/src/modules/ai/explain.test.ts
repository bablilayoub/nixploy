import { describe, expect, it } from "vitest";
import { summarizeMetrics } from "./explain";

const MIB = 1024 * 1024;
const sample = (cpu: number, memoryUsed: number, memoryTotal = 512 * MIB) => ({
	cpu,
	memoryUsed,
	memoryTotal,
});

describe("summarizeMetrics", () => {
	it("says nothing for a window with no trend in it", () => {
		expect(summarizeMetrics([])).toBe("");
		expect(summarizeMetrics([sample(5, 100 * MIB)])).toBe("");
	});

	it("reports the newest reading, the peaks and the drift between halves", () => {
		const text = summarizeMetrics([
			sample(10, 100 * MIB),
			sample(12, 100 * MIB),
			sample(90, 300 * MIB),
			sample(20, 300 * MIB),
		]);
		expect(text).toContain("CPU now 20.0%, peak 90.0%");
		expect(text).toContain("memory now 300 MiB of 512 MiB, peak 300 MiB");
		expect(text).toContain("memory trend +200%");
		expect(text).toContain("(4 samples)");
	});

	it("marks a falling trend as negative and survives a zero baseline", () => {
		expect(summarizeMetrics([sample(1, 400 * MIB), sample(1, 200 * MIB)])).toContain(
			"memory trend -50%",
		);
		expect(summarizeMetrics([sample(1, 0), sample(1, 50 * MIB)])).toContain("memory trend +0%");
	});

	it("leaves the limit out when the sample does not know one", () => {
		expect(summarizeMetrics([sample(1, 10 * MIB, 0), sample(2, 10 * MIB, 0)])).toContain(
			"memory now 10 MiB, peak",
		);
	});
});
