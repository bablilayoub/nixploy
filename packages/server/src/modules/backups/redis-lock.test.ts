import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	held: new Set<string>(),
	releases: 0,
	closes: [] as Array<() => void>,
	ended: 0,
}));
vi.mock("postgres", () => ({
	default: (_url: string, options: { onclose(): void }) => {
		state.closes.push(options.onclose);
		const connection = Object.assign(
			async (strings: TemplateStringsArray, key: string) => {
				if (strings[0]?.includes("pg_try_advisory_lock")) {
					if (state.held.has(key)) return [{ acquired: false }];
					state.held.add(key);
					return [{ acquired: true }];
				}
				state.held.delete(key);
				return [];
			},
			{
				release() {
					state.releases++;
				},
			},
		);
		return {
			reserve: async () => connection,
			end: async () => {
				state.ended++;
			},
		};
	},
}));

import { withRedisBackupLock } from "./redis-lock";

const original = process.env.DATABASE_URL;
afterEach(() => {
	state.held.clear();
	state.closes = [];
	state.releases = 0;
	state.ended = 0;
	if (original === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = original;
});

describe("Redis service backup mutex", () => {
	it("rejects a second backup ID for the same service before it changes Redis", async () => {
		process.env.DATABASE_URL = "postgres://unit-test";
		let finish: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let started: () => void = () => {};
		const active = new Promise<void>((resolve) => {
			started = resolve;
		});
		const first = withRedisBackupLock("redis-service", async () => {
			started();
			await gate;
			return "first";
		});
		await active;
		const second = vi.fn();
		await expect(withRedisBackupLock("redis-service", second)).rejects.toThrow(/already running/);
		expect(second).not.toHaveBeenCalled();
		finish();
		await expect(first).resolves.toBe("first");
		expect(state.held.size).toBe(0);
		expect(state.releases).toBe(2);
		expect(state.ended).toBe(2);
	});
	it("releases the session lock after a producer failure", async () => {
		process.env.DATABASE_URL = "postgres://unit-test";
		await expect(
			withRedisBackupLock("redis-service", async () => {
				throw new Error("copy failed");
			}),
		).rejects.toThrow("copy failed");
		expect(state.held.size).toBe(0);
		expect(state.ended).toBe(1);
	});
	it("signals connection loss and cannot report a successful copy", async () => {
		process.env.DATABASE_URL = "postgres://unit-test";
		await expect(
			withRedisBackupLock("redis-service", async (signal) => {
				state.closes[0]?.();
				expect(signal.aborted).toBe(true);
				return "copied";
			}),
		).rejects.toThrow(/connection was lost/);
		expect(state.releases).toBe(1);
		expect(state.ended).toBe(1);
	});
});
