import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache";

const withClock = (ttlMs = 1_000) => {
	let now = 0;
	const cache = createTtlCache<string>({ ttlMs, clock: () => now });
	return { cache, advance: (ms: number) => (now += ms) };
};

describe("createTtlCache", () => {
	it("serves a cached value inside the window and reloads after it", async () => {
		const { cache, advance } = withClock(1_000);
		const load = vi.fn(async () => `v${load.mock.calls.length}`);

		expect(await cache.get("k", load)).toBe("v1");
		advance(999);
		expect(await cache.get("k", load)).toBe("v1");
		expect(load).toHaveBeenCalledTimes(1);

		advance(2);
		expect(await cache.get("k", load)).toBe("v2");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("collapses concurrent callers into a single load (single flight)", async () => {
		const { cache } = withClock();
		let release!: (value: string) => void;
		const load = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					release = resolve;
				}),
		);

		const calls = [cache.get("k", load), cache.get("k", load), cache.get("k", load)];
		expect(load).toHaveBeenCalledTimes(1);
		release("shared");
		expect(await Promise.all(calls)).toEqual(["shared", "shared", "shared"]);
	});

	it("keeps separate keys apart", async () => {
		const { cache } = withClock();
		await cache.get("a", async () => "A");
		await cache.get("b", async () => "B");
		expect(await cache.get("a", async () => "changed")).toBe("A");
		expect(cache.size).toBe(2);
	});

	it("never caches a rejected load", async () => {
		const { cache } = withClock();
		const load = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error("docker down"))
			.mockResolvedValueOnce("ok");

		await expect(cache.get("k", load)).rejects.toThrow("docker down");
		expect(cache.size).toBe(0);
		expect(await cache.get("k", load)).toBe("ok");
	});

	it("does not raise an unhandled rejection when nobody awaits the retry", async () => {
		const { cache } = withClock();
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			await cache
				.get("k", async () => {
					throw new Error("boom");
				})
				.catch(() => {});
			await new Promise((resolve) => setTimeout(resolve, 5));
			expect(unhandled).toEqual([]);
		} finally {
			process.removeListener("unhandledRejection", onUnhandled);
		}
	});

	it("invalidates one key, a matching subset, or everything", async () => {
		const { cache } = withClock();
		await cache.get("docker:containers:local", async () => "1");
		await cache.get("docker:images:local", async () => "2");
		await cache.get("docker:containers:srv-1", async () => "3");

		cache.invalidate("docker:images:local");
		expect(cache.size).toBe(2);

		cache.invalidateWhere((key) => key.endsWith(":local"));
		expect(cache.size).toBe(1);
		expect(await cache.get("docker:containers:srv-1", async () => "fresh")).toBe("3");

		cache.clear();
		expect(cache.size).toBe(0);
		expect(await cache.get("docker:containers:srv-1", async () => "fresh")).toBe("fresh");
	});
});
