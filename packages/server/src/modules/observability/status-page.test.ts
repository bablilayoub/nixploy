import { describe, expect, it } from "vitest";
import { generateStatusPageToken, uptimePercentFromEvents } from "./status-page";

const at = (iso: string) => new Date(iso);

const START = at("2026-01-01T00:00:00Z");
const NOW = at("2026-01-11T00:00:00Z"); // 10 days

describe("uptimePercentFromEvents", () => {
	it("reports 100% when the probe never flipped and is up", () => {
		expect(uptimePercentFromEvents([], START, NOW, "up")).toBe(100);
	});

	it("reports 0% when the probe never flipped and is down", () => {
		expect(uptimePercentFromEvents([], START, NOW, "down")).toBe(0);
	});

	it("counts the gap between a down flip and its recovery", () => {
		// Down for exactly one of ten days.
		expect(
			uptimePercentFromEvents(
				[
					{ at: at("2026-01-05T00:00:00Z"), status: "down" },
					{ at: at("2026-01-06T00:00:00Z"), status: "up" },
				],
				START,
				NOW,
				"up",
			),
		).toBe(90);
	});

	it("counts an unrecovered outage up to now", () => {
		expect(
			uptimePercentFromEvents(
				[{ at: at("2026-01-09T00:00:00Z"), status: "down" }],
				START,
				NOW,
				"down",
			),
		).toBe(80);
	});

	it("infers the pre-window state from the first flip", () => {
		// The first event is a recovery, so the window opened in an outage.
		expect(
			uptimePercentFromEvents([{ at: at("2026-01-02T00:00:00Z"), status: "up" }], START, NOW, "up"),
		).toBe(90);
	});

	it("ignores events outside the window and stays within 0-100", () => {
		expect(
			uptimePercentFromEvents(
				[
					{ at: at("2025-12-01T00:00:00Z"), status: "down" },
					{ at: at("2026-02-01T00:00:00Z"), status: "up" },
				],
				START,
				NOW,
				"up",
			),
		).toBe(100);
	});

	it("returns 100 for an empty or inverted window", () => {
		expect(uptimePercentFromEvents([], NOW, START, "down")).toBe(100);
	});
});

describe("generateStatusPageToken", () => {
	it("is url-safe and long enough not to be guessed", () => {
		const token = generateStatusPageToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(generateStatusPageToken()).not.toBe(token);
	});
});
