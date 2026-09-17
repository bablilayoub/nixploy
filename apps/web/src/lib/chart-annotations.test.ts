import { describe, expect, it } from "vitest";
import { type AnnotatableSample, snapEventsToSamples } from "./chart-annotations";

const START = Date.parse("2026-09-17T12:00:00.000Z");
/** 30 s apart, which is what the metrics history stores. */
const STEP = 30_000;

const samples: AnnotatableSample[] = Array.from({ length: 10 }, (_unused, index) => ({
	at: START + index * STEP,
	time: `12:${String(index).padStart(2, "0")}:00`,
}));

const event = (kind: string, at: number, id = kind) => ({
	serviceEventId: id,
	kind,
	occurredAt: new Date(at).toISOString(),
});

describe("snapEventsToSamples", () => {
	it("snaps an event onto the sample it happened closest to", () => {
		const [annotation] = snapEventsToSamples(samples, [
			event("deploy_finished", START + 3 * STEP + 2000),
		]);
		expect(annotation?.x).toBe(samples[3]?.time);
		expect(annotation?.mark).toBe("▲");
	});

	it("drops an event that happened outside the plotted window", () => {
		expect(snapEventsToSamples(samples, [event("oom_killed", START - 10 * STEP)])).toEqual([]);
		expect(snapEventsToSamples(samples, [event("oom_killed", START + 100 * STEP)])).toEqual([]);
	});

	it("ignores kinds that are not worth a line", () => {
		expect(snapEventsToSamples(samples, [event("config_changed", START)])).toEqual([]);
		expect(snapEventsToSamples(samples, [event("task_started", START)])).toEqual([]);
	});

	it("draws one line per pixel column, not two on top of each other", () => {
		const annotations = snapEventsToSamples(samples, [
			event("task_failed", START + 2 * STEP, "a"),
			event("task_failed", START + 2 * STEP + 500, "b"),
		]);
		expect(annotations).toHaveLength(1);
		expect(annotations[0]?.id).toBe("a");
	});

	it("still draws two different kinds that land on one sample", () => {
		const annotations = snapEventsToSamples(samples, [
			event("deploy_finished", START + 2 * STEP, "a"),
			event("rollback", START + 2 * STEP, "b"),
		]);
		expect(annotations.map((entry) => entry.mark)).toEqual(["▲", "↺"]);
	});

	it("draws nothing when there is not enough of a window to place a line in", () => {
		expect(snapEventsToSamples([], [event("deploy_finished", START)])).toEqual([]);
		expect(
			snapEventsToSamples([samples[0] as AnnotatableSample], [event("deploy_finished", START)]),
		).toEqual([]);
	});

	it("ignores an unparseable timestamp rather than snapping it to sample zero", () => {
		expect(
			snapEventsToSamples(samples, [
				{ serviceEventId: "x", kind: "deploy_failed", occurredAt: "not a date" },
			]),
		).toEqual([]);
	});
});
