import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: { query: { environments: { findMany: async () => [] } } } }));
vi.mock("../observability/service-events", () => ({ recordServiceEvents: async () => 0 }));

import type { SwarmTaskFacts } from "../observability/task-events";
import type { StatusCorrection } from "./reconciler";
import {
	buildCorrectionEventInputs,
	buildServiceNameIndex,
	buildTaskEventInputs,
	composeServiceSuffix,
	type TimelineOwner,
} from "./reconciler-timeline";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

const owner = (overrides: Partial<TimelineOwner> = {}): TimelineOwner => ({
	serviceType: "application",
	serviceId: "app-1",
	appName: "web-abc123",
	environmentId: "env-1",
	organizationId: "org-1",
	...overrides,
});

const stack = owner({ serviceType: "compose", serviceId: "cmp-1", appName: "shop-def456" });

const task = (overrides: Partial<SwarmTaskFacts> = {}): SwarmTaskFacts => ({
	id: "task-1",
	serviceName: "web-abc123",
	slot: 1,
	state: "failed",
	desiredState: "running",
	message: null,
	error: "task: non-zero exit (1)",
	exitCode: 1,
	timestamp: new Date(NOW - 1000).toISOString(),
	...overrides,
});

describe("buildServiceNameIndex", () => {
	it("maps a swarm service name straight onto its service", () => {
		const index = buildServiceNameIndex([owner()], new Map());
		expect(index.get("web-abc123")?.serviceId).toBe("app-1");
	});

	it("maps every service of a stack back onto the one compose row", () => {
		const index = buildServiceNameIndex(
			[stack],
			new Map([["shop-def456", ["shop-def456_api", "shop-def456_worker"]]]),
		);
		expect(index.get("shop-def456_api")?.serviceId).toBe("cmp-1");
		expect(index.get("shop-def456_worker")?.serviceId).toBe("cmp-1");
	});

	it("knows nothing about services Nixploy does not own", () => {
		const index = buildServiceNameIndex([owner()], new Map());
		expect(index.has("nixploy-traefik")).toBe(false);
	});
});

describe("composeServiceSuffix", () => {
	it("names the service inside a stack", () => {
		expect(composeServiceSuffix("shop-def456_api", "shop-def456")).toBe("api");
	});

	it("has nothing to add for a service that is the app itself", () => {
		expect(composeServiceSuffix("web-abc123", "web-abc123")).toBeNull();
		expect(composeServiceSuffix("something-else", "web-abc123")).toBeNull();
	});
});

describe("buildTaskEventInputs", () => {
	const snapshot = (tasks: SwarmTaskFacts[]) => ({
		byName: new Map(),
		byStack: new Map([["shop-def456", ["shop-def456_api"]]]),
		tasks,
	});

	it("attaches a task to the service that owns it", () => {
		const index = buildServiceNameIndex([owner()], new Map());
		const { inputs } = buildTaskEventInputs(snapshot([task()]), index, NOW);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toMatchObject({
			organizationId: "org-1",
			serviceType: "application",
			serviceId: "app-1",
			kind: "task_failed",
			dedupeKey: "web-abc123:task:task-1:failed",
		});
	});

	it("says which service of a stack died", () => {
		const index = buildServiceNameIndex([stack], snapshot([]).byStack);
		const { inputs } = buildTaskEventInputs(
			snapshot([task({ serviceName: "shop-def456_api" })]),
			index,
			NOW,
		);
		expect(inputs[0]?.title).toContain("— api");
		expect(inputs[0]?.metadata).toMatchObject({ service: "api" });
		// Two services of one stack share a serviceId, so the swarm service name
		// has to be part of the key the unique index sees.
		expect(inputs[0]?.dedupeKey).toBe("shop-def456_api:task:task-1:failed");
	});

	it("drops tasks of services Nixploy does not own", () => {
		const index = buildServiceNameIndex([owner()], new Map());
		const { inputs } = buildTaskEventInputs(
			snapshot([task({ serviceName: "nixploy-traefik" })]),
			index,
			NOW,
		);
		expect(inputs).toEqual([]);
	});
});

describe("buildCorrectionEventInputs", () => {
	const correction = (overrides: Partial<StatusCorrection> = {}): StatusCorrection => ({
		kind: "application",
		id: "app-1",
		appName: "web-abc123",
		from: "running",
		to: "error",
		environmentId: "env-1",
		...overrides,
	});

	it("records drift the reconciler had to correct", () => {
		const index = buildServiceNameIndex([owner()], new Map());
		const [event] = buildCorrectionEventInputs([correction()], index);
		expect(event).toMatchObject({
			kind: "status_changed",
			severity: "error",
			serviceId: "app-1",
			title: "Status changed to error",
		});
		expect(event?.metadata).toMatchObject({ from: "running", to: "error", source: "reconciler" });
	});

	it("grades the severity by what the service ended up as", () => {
		const index = buildServiceNameIndex([owner()], new Map());
		const severity = (to: StatusCorrection["to"]) =>
			buildCorrectionEventInputs([correction({ to })], index)[0]?.severity;
		expect(severity("idle")).toBe("warning");
		expect(severity("running")).toBe("info");
	});

	it("refuses a correction whose id does not match the service of that name", () => {
		// appName is globally unique, so this is a stale correction, not a
		// second service — writing it would file history under the wrong row.
		const index = buildServiceNameIndex([owner()], new Map());
		expect(buildCorrectionEventInputs([correction({ id: "app-2" })], index)).toEqual([]);
	});
});
