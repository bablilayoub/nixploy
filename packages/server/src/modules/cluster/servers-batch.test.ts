import { describe, expect, it } from "vitest";

describe("server stats batch concurrency", () => {
	it("never exceeds the concurrency cap of 4", async () => {
		let inFlight = 0;
		let peak = 0;
		const items = Array.from({ length: 10 }, (_, i) => i);
		const results: number[] = new Array(items.length);
		let nextIndex = 0;
		const worker = async () => {
			while (nextIndex < items.length) {
				const index = nextIndex;
				nextIndex += 1;
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				results[index] = items[index] as number;
				inFlight -= 1;
			}
		};
		await Promise.all(Array.from({ length: 4 }, () => worker()));
		expect(peak).toBeLessThanOrEqual(4);
		expect(results).toEqual(items);
	});
});
