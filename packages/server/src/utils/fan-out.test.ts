import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_FANOUT_CONCURRENCY,
	fanOutConcurrency,
	forEachServerGroup,
	groupByServer,
	LOCAL_SERVER_KEY,
	mapWithConcurrency,
} from "./fan-out";

const originalConcurrency = process.env.NIXPLOY_FANOUT_CONCURRENCY;

afterEach(() => {
	if (originalConcurrency === undefined) delete process.env.NIXPLOY_FANOUT_CONCURRENCY;
	else process.env.NIXPLOY_FANOUT_CONCURRENCY = originalConcurrency;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("fanOutConcurrency", () => {
	it("defaults to 4 and honors the env override", () => {
		delete process.env.NIXPLOY_FANOUT_CONCURRENCY;
		expect(fanOutConcurrency()).toBe(DEFAULT_FANOUT_CONCURRENCY);
		process.env.NIXPLOY_FANOUT_CONCURRENCY = "9";
		expect(fanOutConcurrency()).toBe(9);
		// An explicit argument wins over the environment.
		expect(fanOutConcurrency(2)).toBe(2);
	});

	it("ignores junk values", () => {
		process.env.NIXPLOY_FANOUT_CONCURRENCY = "not-a-number";
		expect(fanOutConcurrency()).toBe(DEFAULT_FANOUT_CONCURRENCY);
		process.env.NIXPLOY_FANOUT_CONCURRENCY = "0";
		expect(fanOutConcurrency()).toBe(DEFAULT_FANOUT_CONCURRENCY);
	});
});

describe("mapWithConcurrency", () => {
	it("keeps result order and never exceeds the pool size", async () => {
		let inFlight = 0;
		let peak = 0;
		const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await tick();
			inFlight -= 1;
			return value * 10;
		});
		expect(results).toEqual([10, 20, 30, 40, 50, 60]);
		expect(peak).toBe(2);
	});

	it("returns early for an empty list", async () => {
		expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
	});
});

describe("groupByServer", () => {
	it("buckets rows by server and files null under the local key", () => {
		const rows = [
			{ id: "a", serverId: null },
			{ id: "b", serverId: "srv-1" },
			{ id: "c", serverId: "srv-1" },
			{ id: "d", serverId: undefined },
		];
		const groups = groupByServer(rows, (row) => row.serverId);
		expect([...groups.keys()]).toEqual([LOCAL_SERVER_KEY, "srv-1"]);
		expect(groups.get(LOCAL_SERVER_KEY)?.map((row) => row.id)).toEqual(["a", "d"]);
		expect(groups.get("srv-1")?.map((row) => row.id)).toEqual(["b", "c"]);
	});
});

describe("forEachServerGroup", () => {
	it("runs servers in parallel while keeping each server's rows sequential", async () => {
		const rows = [
			{ id: "a", serverId: "srv-1" },
			{ id: "b", serverId: "srv-1" },
			{ id: "c", serverId: "srv-2" },
			{ id: "d", serverId: null },
		];
		const order: string[] = [];
		let serversInFlight = 0;
		let peak = 0;

		await forEachServerGroup(
			rows,
			(row) => row.serverId,
			async ({ items }) => {
				serversInFlight += 1;
				peak = Math.max(peak, serversInFlight);
				for (const row of items) {
					await tick();
					order.push(row.id);
				}
				serversInFlight -= 1;
			},
		);

		expect(peak).toBe(3);
		// srv-1's own rows stay in order; the other servers interleave.
		expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
		expect(order).toHaveLength(4);
	});

	it("skips servers the breaker predicate rejects, never the local host", async () => {
		const rows = [
			{ id: "a", serverId: "down" },
			{ id: "b", serverId: "up" },
			{ id: "c", serverId: null },
		];
		const seen: string[] = [];
		const result = await forEachServerGroup(
			rows,
			(row) => row.serverId,
			async ({ items }) => {
				for (const row of items) seen.push(row.id);
			},
			{ skipServer: (serverId) => serverId === "down" },
		);
		expect(seen).toEqual(["b", "c"]);
		expect(result.skipped).toEqual(["down"]);
		expect(result.processed).toBe(2);
	});

	it("does not let one failing server abort the pass", async () => {
		const rows = [
			{ id: "a", serverId: "boom" },
			{ id: "b", serverId: "fine" },
		];
		const seen: string[] = [];
		await expect(
			forEachServerGroup(
				rows,
				(row) => row.serverId,
				async ({ serverId, items }) => {
					if (serverId === "boom") throw new Error("host is gone");
					for (const row of items) seen.push(row.id);
				},
			),
		).resolves.toMatchObject({ processed: 2 });
		expect(seen).toEqual(["b"]);
	});

	it("bounds how many servers it talks to at once", async () => {
		const rows = Array.from({ length: 10 }, (_, index) => ({ serverId: `srv-${index}` }));
		let inFlight = 0;
		let peak = 0;
		await forEachServerGroup(
			rows,
			(row) => row.serverId,
			async () => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await tick();
				inFlight -= 1;
			},
			{ concurrency: 3 },
		);
		expect(peak).toBe(3);
	});
});
