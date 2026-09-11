import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformEvent } from "../modules/deployment/notify";

/**
 * `/ws/events` org scoping. The deployment module is mocked away (it pulls the
 * whole deploy engine, dockerode included) and replaced with a plain emitter,
 * so this suite is about one thing: which frames reach which socket.
 */

const bus = new EventEmitter();

vi.mock("../modules/deployment", () => ({
	onPlatformEvent: (listener: (event: PlatformEvent) => void) => {
		bus.on("platform", listener);
		return () => {
			bus.off("platform", listener);
		};
	},
	toClientFrame: (event: PlatformEvent) => {
		const { organizationId: _organizationId, ...rest } = event;
		return rest;
	},
}));

const resolveOrg = vi.fn<(session: unknown) => Promise<string>>();
vi.mock("./access", () => ({
	resolveWsOrganizationId: (session: unknown) => resolveOrg(session),
}));

const { handlePlatformEvents, shouldDeliver } = await import("./events");

interface FakeSocket {
	readyState: number;
	bufferedAmount: number;
	sent: string[];
	closedWith: { code: number; reason?: string } | null;
	handlers: Record<string, Array<() => void>>;
	send: (data: string) => void;
	close: (code: number, reason?: string) => void;
	terminate: () => void;
	on: (event: string, handler: () => void) => FakeSocket;
	OPEN: number;
}

function fakeSocket(): FakeSocket {
	const socket: FakeSocket = {
		readyState: 1,
		OPEN: 1,
		bufferedAmount: 0,
		sent: [],
		closedWith: null,
		handlers: {},
		send(data) {
			socket.sent.push(data);
		},
		close(code, reason) {
			socket.closedWith = { code, reason };
			socket.readyState = 3;
		},
		terminate() {
			socket.readyState = 3;
		},
		on(event, handler) {
			const handlers = socket.handlers[event] ?? [];
			handlers.push(handler);
			socket.handlers[event] = handlers;
			return socket;
		},
	};
	return socket;
}

const req = {} as IncomingMessage;
const session = { user: { id: "u1" }, session: { activeOrganizationId: "org_a" } } as never;

const frames = (socket: FakeSocket) =>
	socket.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);

const deployment = (organizationId: string, deploymentId = "d1"): PlatformEvent => ({
	kind: "deployment",
	organizationId,
	deploymentId,
	appName: "whoami",
	applicationId: "app_1",
	composeId: null,
	status: "done",
});

beforeEach(() => {
	bus.removeAllListeners();
	resolveOrg.mockReset();
});

describe("shouldDeliver", () => {
	it("matches on the organization and nothing else", () => {
		expect(shouldDeliver(deployment("org_a"), "org_a")).toBe(true);
		expect(shouldDeliver(deployment("org_b"), "org_a")).toBe(false);
	});
});

describe("handlePlatformEvents", () => {
	it("sends a ready frame once the organization resolved", async () => {
		resolveOrg.mockResolvedValue("org_a");
		const ws = fakeSocket();
		await handlePlatformEvents(ws as never, req, session);
		expect(frames(ws)).toEqual([{ kind: "ready" }]);
	});

	it("delivers only this organization's events, without the tenant id", async () => {
		resolveOrg.mockResolvedValue("org_a");
		const ws = fakeSocket();
		await handlePlatformEvents(ws as never, req, session);

		bus.emit("platform", deployment("org_b", "other-tenant"));
		bus.emit("platform", deployment("org_a", "mine"));

		const delivered = frames(ws).filter((frame) => frame.kind === "deployment");
		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.deploymentId).toBe("mine");
		expect(delivered[0]?.organizationId).toBeUndefined();
		expect(ws.sent.join("")).not.toContain("org_a");
	});

	it("stops delivering after the socket closes", async () => {
		resolveOrg.mockResolvedValue("org_a");
		const ws = fakeSocket();
		await handlePlatformEvents(ws as never, req, session);
		for (const handler of ws.handlers.close ?? []) handler();

		bus.emit("platform", deployment("org_a", "after-close"));
		expect(ws.sent.join("")).not.toContain("after-close");
		expect(bus.listenerCount("platform")).toBe(0);
	});

	it("refuses the socket when the session cannot resolve an organization", async () => {
		resolveOrg.mockRejectedValue(new Error("Two-factor authentication is required"));
		const ws = fakeSocket();
		await handlePlatformEvents(ws as never, req, session);

		expect(ws.closedWith?.code).toBe(1008);
		expect(frames(ws)[0]).toMatchObject({ type: "error" });
		expect(bus.listenerCount("platform")).toBe(0);
	});
});
