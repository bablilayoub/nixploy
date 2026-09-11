import { describe, expect, it } from "vitest";

import {
	BASE_BACKOFF_MS,
	MAX_BACKOFF_MS,
	nextBackoffMs,
	parseEventFrame,
} from "@/lib/events-socket";

describe("parseEventFrame", () => {
	it("parses a deployment frame and normalizes its nullable fields", () => {
		expect(
			parseEventFrame(
				JSON.stringify({
					kind: "deployment",
					deploymentId: "d1",
					appName: "whoami",
					applicationId: "app_1",
					status: "running",
				}),
			),
		).toEqual({
			kind: "deployment",
			deploymentId: "d1",
			appName: "whoami",
			applicationId: "app_1",
			composeId: null,
			status: "running",
			queuePosition: null,
			isPreview: false,
		});
	});

	it("parses queue and service-status frames", () => {
		expect(parseEventFrame(JSON.stringify({ kind: "queue", depth: 2 }))).toEqual({
			kind: "queue",
			depth: 2,
		});
		expect(
			parseEventFrame(
				JSON.stringify({ kind: "service-status", serviceKind: "redis", id: "r1", status: "idle" }),
			),
		).toEqual({
			kind: "service-status",
			serviceKind: "redis",
			id: "r1",
			status: "idle",
			appName: null,
		});
	});

	it("parses the control frames the socket handles itself", () => {
		expect(parseEventFrame(JSON.stringify({ kind: "ready" }))?.kind).toBe("ready");
		expect(
			parseEventFrame(JSON.stringify({ kind: "heartbeat", at: "2026-09-11T00:00:00Z" })),
		).toEqual({ kind: "heartbeat", at: "2026-09-11T00:00:00Z", message: undefined });
	});

	it("returns null for anything it does not understand rather than throwing", () => {
		// A frame kind from a newer server must not kill `onmessage` for every
		// other consumer in the tab.
		expect(parseEventFrame("")).toBeNull();
		expect(parseEventFrame("not json")).toBeNull();
		expect(parseEventFrame("null")).toBeNull();
		expect(parseEventFrame(JSON.stringify({ kind: "from-the-future" }))).toBeNull();
		expect(parseEventFrame(JSON.stringify({ kind: "deployment", status: "done" }))).toBeNull();
		expect(parseEventFrame(JSON.stringify({ kind: "queue", depth: "lots" }))).toBeNull();
	});
});

describe("nextBackoffMs", () => {
	const noJitter = () => 0.5;

	it("doubles per attempt from the base delay", () => {
		expect(nextBackoffMs(1, noJitter)).toBe(BASE_BACKOFF_MS);
		expect(nextBackoffMs(2, noJitter)).toBe(BASE_BACKOFF_MS * 2);
		expect(nextBackoffMs(3, noJitter)).toBe(BASE_BACKOFF_MS * 4);
	});

	it("never exceeds the ceiling, however long the panel is down", () => {
		for (const attempt of [10, 50, 1000]) {
			expect(nextBackoffMs(attempt, () => 1)).toBeLessThanOrEqual(Math.round(MAX_BACKOFF_MS * 1.2));
			expect(nextBackoffMs(attempt, noJitter)).toBe(MAX_BACKOFF_MS);
		}
	});

	it("spreads reconnects with ±20 % jitter so tabs do not stampede a restart", () => {
		const low = nextBackoffMs(4, () => 0);
		const high = nextBackoffMs(4, () => 1);
		expect(low).toBeLessThan(high);
		expect(low).toBeGreaterThanOrEqual(Math.round(BASE_BACKOFF_MS * 8 * 0.8));
		expect(high).toBeLessThanOrEqual(Math.round(BASE_BACKOFF_MS * 8 * 1.2));
	});

	it("treats a zero or negative attempt as the first one", () => {
		expect(nextBackoffMs(0, noJitter)).toBe(BASE_BACKOFF_MS);
		expect(nextBackoffMs(-3, noJitter)).toBe(BASE_BACKOFF_MS);
	});
});
