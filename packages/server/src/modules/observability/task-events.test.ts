import { describe, expect, it } from "vitest";
import {
	deriveTaskEvent,
	deriveTaskEvents,
	MAX_TASK_EVENTS_PER_SERVICE,
	SIGKILL_EXIT_CODE,
	type SwarmTaskFacts,
	TASK_EVENT_LOOKBACK_MS,
} from "./task-events";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

const task = (overrides: Partial<SwarmTaskFacts> = {}): SwarmTaskFacts => ({
	id: "task-1",
	serviceName: "web-abc123",
	slot: 1,
	state: "running",
	desiredState: "running",
	message: "started",
	error: null,
	exitCode: null,
	timestamp: new Date(NOW - 1000).toISOString(),
	...overrides,
});

describe("deriveTaskEvent", () => {
	it("records a running task as a start", () => {
		const event = deriveTaskEvent(task());
		expect(event?.kind).toBe("task_started");
		expect(event?.severity).toBe("info");
		expect(event?.dedupeKey).toBe("task:task-1:running");
		expect(event?.title).toBe("Task started (replica 1)");
	});

	it("ignores a running task Swarm is already draining", () => {
		// A rolling update overlaps the old and the new task; the old one's
		// "running" is not an event anyone wants on the timeline.
		expect(deriveTaskEvent(task({ desiredState: "shutdown" }))).toBeNull();
		expect(deriveTaskEvent(task({ desiredState: "remove" }))).toBeNull();
	});

	it("ignores the normal lifecycle states", () => {
		for (const state of ["new", "pending", "assigned", "preparing", "starting"]) {
			expect(deriveTaskEvent(task({ state }))).toBeNull();
		}
		// We asked for these: a redeploy shuts tasks down, a one-shot completes.
		expect(deriveTaskEvent(task({ state: "shutdown" }))).toBeNull();
		expect(deriveTaskEvent(task({ state: "complete" }))).toBeNull();
	});

	it("records a failed task with its exit code and error", () => {
		const event = deriveTaskEvent(
			task({ state: "failed", exitCode: 1, error: "task: non-zero exit (1)" }),
		);
		expect(event?.kind).toBe("task_failed");
		expect(event?.severity).toBe("error");
		expect(event?.message).toBe("task: non-zero exit (1)");
		expect(event?.metadata).toMatchObject({ exitCode: 1, taskId: "task-1", state: "failed" });
	});

	it("treats a rejected and an orphaned task as failures too", () => {
		expect(deriveTaskEvent(task({ state: "rejected" }))?.kind).toBe("task_failed");
		expect(deriveTaskEvent(task({ state: "orphaned" }))?.kind).toBe("task_failed");
	});

	it("calls exit 137 a kill, and says the two causes rather than asserting one", () => {
		const event = deriveTaskEvent(task({ state: "failed", exitCode: SIGKILL_EXIT_CODE }));
		expect(event?.kind).toBe("oom_killed");
		expect(event?.metadata).toMatchObject({ oomReported: false, exitCode: 137 });
		expect(event?.message).toContain("out-of-memory");
		expect(event?.message).toContain("stop that timed out");
	});

	it("states the cause outright when the daemon reported OOM", () => {
		const event = deriveTaskEvent(
			task({ state: "failed", exitCode: 137, error: "task: OOMKilled" }),
		);
		expect(event?.kind).toBe("oom_killed");
		expect(event?.metadata).toMatchObject({ oomReported: true });
		expect(event?.message).toContain("out-of-memory killer");
	});

	it("names no replica for a global-mode task", () => {
		expect(deriveTaskEvent(task({ slot: null }))?.title).toBe("Task started");
	});
});

describe("deriveTaskEvents", () => {
	it("drops tasks whose state predates the lookback window", () => {
		const old = task({
			id: "old",
			state: "failed",
			timestamp: new Date(NOW - TASK_EVENT_LOOKBACK_MS - 1).toISOString(),
		});
		const fresh = task({ id: "fresh", state: "failed" });
		const { drafts } = deriveTaskEvents([old, fresh], NOW);
		expect(drafts.map((draft) => draft.dedupeKey)).toEqual(["task:fresh:failed"]);
	});

	it("keeps a task with no usable timestamp rather than losing a failure", () => {
		const { drafts } = deriveTaskEvents(
			[task({ id: "no-time", state: "failed", timestamp: null })],
			NOW,
		);
		expect(drafts).toHaveLength(1);
		expect(drafts[0]?.occurredAt).toBeNull();
	});

	it("caps one service per pass and reports what it dropped", () => {
		const tasks = Array.from({ length: MAX_TASK_EVENTS_PER_SERVICE + 3 }, (_unused, index) =>
			task({
				id: `task-${index}`,
				state: "failed",
				timestamp: new Date(NOW - index * 1000).toISOString(),
			}),
		);
		const { drafts, dropped } = deriveTaskEvents(tasks, NOW);
		expect(drafts).toHaveLength(MAX_TASK_EVENTS_PER_SERVICE);
		expect(dropped.get("web-abc123")).toBe(3);
		// Newest first: the most recent failure is the one being investigated.
		expect(drafts[0]?.dedupeKey).toBe("task:task-0:failed");
	});

	it("caps per service, not across the whole pass", () => {
		const tasks = [
			...Array.from({ length: MAX_TASK_EVENTS_PER_SERVICE }, (_unused, index) =>
				task({ id: `a-${index}`, serviceName: "a", state: "failed" }),
			),
			task({ id: "b-1", serviceName: "b", state: "failed" }),
		];
		const { drafts, dropped } = deriveTaskEvents(tasks, NOW);
		expect(drafts).toHaveLength(MAX_TASK_EVENTS_PER_SERVICE + 1);
		expect(dropped.size).toBe(0);
	});
});

describe("OOM detection", () => {
	it("reads Docker's own spelling, and does not fire on words containing 'oom'", () => {
		const failed = (error: string) =>
			deriveTaskEvent(task({ state: "failed", exitCode: 1, error }));
		for (const error of ["task: OOMKilled", "oom-kill invoked", "Container out of memory"]) {
			expect(failed(error)?.kind, error).toBe("oom_killed");
		}
		for (const error of ["no room left on device", "zoom client failed"]) {
			expect(failed(error)?.kind, error).toBe("task_failed");
		}
	});
});
