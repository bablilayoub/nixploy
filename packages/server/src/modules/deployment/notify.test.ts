import { describe, expect, it } from "vitest";
import { MAX_NOTIFY_PAYLOAD_BYTES } from "../../db/listen";
import {
	decodeCancelNotice,
	decodeEventEnvelope,
	decodePlatformEvent,
	decodeQueuedNotice,
	encodeCancelNotice,
	encodeEventEnvelope,
	encodePlatformEvent,
	encodeQueuedNotice,
	isOwnEnvelope,
	type NotifyEnvelope,
	type PlatformEvent,
	toClientFrame,
} from "./notify";

const deploymentEvent: PlatformEvent = {
	kind: "deployment",
	organizationId: "org_1",
	deploymentId: "dep_1",
	appName: "whoami",
	applicationId: "app_1",
	composeId: null,
	status: "running",
	queuePosition: null,
	isPreview: false,
};

describe("platform event encode/decode", () => {
	it("round-trips a deployment frame", () => {
		expect(decodePlatformEvent(encodePlatformEvent(deploymentEvent))).toEqual(deploymentEvent);
	});

	it("round-trips a queue frame", () => {
		const event: PlatformEvent = { kind: "queue", organizationId: "org_1", depth: 3 };
		expect(decodePlatformEvent(encodePlatformEvent(event))).toEqual(event);
	});

	it("round-trips a service-status frame", () => {
		const event: PlatformEvent = {
			kind: "service-status",
			organizationId: "org_1",
			serviceKind: "postgres",
			id: "pg_1",
			status: "running",
			appName: "db-1",
		};
		expect(decodePlatformEvent(encodePlatformEvent(event))).toEqual(event);
	});

	it("stays far below the NOTIFY payload cap", () => {
		const payload = encodePlatformEvent(deploymentEvent);
		expect(Buffer.byteLength(payload, "utf8")).toBeLessThan(MAX_NOTIFY_PAYLOAD_BYTES / 4);
	});

	it("rejects malformed, unknown and untenanted payloads instead of throwing", () => {
		expect(decodePlatformEvent("not json")).toBeNull();
		expect(decodePlatformEvent("null")).toBeNull();
		expect(decodePlatformEvent('"a string"')).toBeNull();
		// A newer worker publishing a kind this build does not know: ignore it.
		expect(decodePlatformEvent(JSON.stringify({ kind: "future", organizationId: "o" }))).toBeNull();
		// No tenant → undeliverable, and delivering it would be a leak.
		expect(
			decodePlatformEvent(
				JSON.stringify({ kind: "deployment", deploymentId: "d", status: "done" }),
			),
		).toBeNull();
		expect(
			decodePlatformEvent(JSON.stringify({ kind: "queue", organizationId: "o", depth: "many" })),
		).toBeNull();
		expect(
			decodePlatformEvent(
				JSON.stringify({
					kind: "service-status",
					organizationId: "o",
					serviceKind: "kafka",
					id: "x",
					status: "running",
				}),
			),
		).toBeNull();
	});

	it("never lets the tenant id reach a client frame", () => {
		const frame = toClientFrame(deploymentEvent) as Record<string, unknown>;
		expect(frame.organizationId).toBeUndefined();
		expect(frame.deploymentId).toBe("dep_1");
		expect(JSON.stringify(frame)).not.toContain("org_1");
	});
});

describe("queue wake-up and cancel notices", () => {
	it("round-trips a queued notice, local server included", () => {
		expect(decodeQueuedNotice(encodeQueuedNotice({ deploymentId: "d1", serverId: null }))).toEqual({
			deploymentId: "d1",
			serverId: null,
		});
		expect(decodeQueuedNotice(encodeQueuedNotice({ deploymentId: "d1", serverId: "srv" }))).toEqual(
			{
				deploymentId: "d1",
				serverId: "srv",
			},
		);
	});

	it("round-trips a cancel notice", () => {
		expect(decodeCancelNotice(encodeCancelNotice({ deploymentId: "d1" }))).toEqual({
			deploymentId: "d1",
		});
	});

	it("ignores garbage on either channel", () => {
		expect(decodeQueuedNotice("{")).toBeNull();
		expect(decodeQueuedNotice("{}")).toBeNull();
		expect(decodeCancelNotice("{}")).toBeNull();
		expect(decodeCancelNotice("[]")).toBeNull();
	});
});

describe("notify envelope", () => {
	it("round-trips an event and reports it as this process's own", () => {
		const envelope = decodeEventEnvelope(encodeEventEnvelope(deploymentEvent, "origin-a"));
		expect(envelope?.event).toEqual(deploymentEvent);
		expect(envelope?.origin).toBe("origin-a");
		expect(isOwnEnvelope(envelope as NotifyEnvelope, "origin-a")).toBe(true);
		expect(isOwnEnvelope(envelope as NotifyEnvelope, "origin-b")).toBe(false);
	});

	it("accepts a bare event from an older publisher and always delivers it", () => {
		// Mixed-version rollout: the other half may still send an unwrapped frame.
		const envelope = decodeEventEnvelope(encodePlatformEvent(deploymentEvent));
		expect(envelope?.event).toEqual(deploymentEvent);
		expect(envelope?.origin).toBe("");
		expect(isOwnEnvelope(envelope as NotifyEnvelope, "anything")).toBe(false);
	});

	it("rejects garbage and unknown frames without throwing", () => {
		expect(decodeEventEnvelope("nope")).toBeNull();
		expect(decodeEventEnvelope("null")).toBeNull();
		expect(decodeEventEnvelope(JSON.stringify({ o: "x", e: { kind: "future" } }))).toBeNull();
	});
});
