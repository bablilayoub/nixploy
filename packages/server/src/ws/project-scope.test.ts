import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { fakeWsSession } from "../test-utils/fake-session";

const state = vi.hoisted(() => ({
	resolveFilter: vi.fn(),
	getSession: vi.fn(),
	handler: vi.fn(),
}));

vi.mock("../lib/auth", () => ({ trustedOriginsWithDashboardDomain: async () => [] }));
vi.mock("./auth", () => ({ getSessionFromUpgrade: state.getSession }));
vi.mock("../modules/projects/project-scope", async (original) => ({
	...(await original<typeof import("../modules/projects/project-scope")>()),
	resolveProjectFilter: state.resolveFilter,
}));
vi.mock("./docker-terminal", () => ({ handleDockerTerminal: state.handler }));

import { assertProjectVisible } from "../modules/projects/project-scope";
import { closeWebSocketServer, setupWebSocketServer } from "./index";
import { closeWithError, sendJson } from "./utils";

let server: Server;
let origin: string;

beforeAll(async () => {
	server = createServer();
	setupWebSocketServer(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No test listener");
	origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	await closeWebSocketServer();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
	state.resolveFilter.mockReset();
	state.getSession.mockReset();
	state.handler.mockReset();
	state.resolveFilter.mockResolvedValue({ kind: "projects", projectIds: new Set(["visible"]) });
	state.getSession.mockImplementation(async (request) =>
		fakeWsSession({ userId: request.headers.cookie ?? "member" }),
	);
	state.handler.mockImplementation(async (socket, request) => {
		// An asynchronous authorization funnel must retain the caller's scope.
		await Promise.resolve();
		const projectId = new URL(request.url, origin).searchParams.get("project") ?? "hidden";
		try {
			assertProjectVisible(projectId, "Service");
			sendJson(socket, { type: "ready" });
			socket.close(1000);
		} catch (error) {
			closeWithError(socket, error instanceof Error ? error.message : "Access denied");
		}
	});
});

/** Real upgrade/close framing; only identity resolution and the terminal are boundaries. */
async function connect(project: string, cookie = "member") {
	return await new Promise<{ status: number; frames: unknown[]; closeCode?: number }>(
		(resolve, reject) => {
			const socket = new WebSocket(
				`${origin.replace("http:", "ws:")}/ws/terminal?project=${project}`,
				{
					headers: { origin, cookie },
				},
			);
			const frames: unknown[] = [];
			let rejectedUpgrade = false;
			const timeout = setTimeout(() => {
				socket.terminate();
				reject(new Error("Test upgrade timed out"));
			}, 3_000);
			socket.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
			socket.on("unexpected-response", (_request, response) => {
				rejectedUpgrade = true;
				response.resume();
				clearTimeout(timeout);
				resolve({ status: response.statusCode ?? 0, frames });
				socket.terminate();
			});
			socket.on("error", (error) => {
				if (rejectedUpgrade) return;
				clearTimeout(timeout);
				reject(error);
			});
			socket.on("close", (closeCode) => {
				clearTimeout(timeout);
				if (!rejectedUpgrade) resolve({ status: 101, frames, closeCode });
			});
		},
	);
}

describe("WebSocket project authorization at the upgrade boundary", () => {
	it("allows a visible project and hides another project before a terminal opens", async () => {
		expect((await connect("visible")).frames).toEqual([{ type: "ready" }]);
		const hidden = await connect("hidden");
		expect(hidden.closeCode).toBe(1008);
		expect(hidden.frames).toEqual([{ type: "error", message: "Service not found" }]);
	});

	it("resolves team visibility again for a new session rather than keeping the old allow-list", async () => {
		expect((await connect("visible")).closeCode).toBe(1000);
		state.resolveFilter.mockResolvedValue({ kind: "projects", projectIds: new Set() });
		expect((await connect("visible")).frames).toEqual([
			{ type: "error", message: "Service not found" },
		]);
		expect(state.resolveFilter).toHaveBeenCalledTimes(2);
	});

	it("keeps concurrent callers' project scopes separate across asynchronous work", async () => {
		state.resolveFilter.mockImplementation(async (userId) => ({
			kind: "projects",
			projectIds: new Set([userId]),
		}));
		const [ownA, hiddenA, ownB, hiddenB] = await Promise.all([
			connect("a", "a"),
			connect("b", "a"),
			connect("b", "b"),
			connect("a", "b"),
		]);
		expect(ownA.closeCode).toBe(1000);
		expect(ownB.closeCode).toBe(1000);
		expect(hiddenA.closeCode).toBe(1008);
		expect(hiddenB.closeCode).toBe(1008);
	});

	it("fails closed when project visibility cannot be resolved", async () => {
		state.resolveFilter.mockRejectedValue(new Error("Database unavailable"));
		expect((await connect("visible")).status).toBe(503);
		expect(state.handler).not.toHaveBeenCalled();
	});

	it("reauthenticates each new socket and rejects a revoked session before dispatch", async () => {
		expect((await connect("visible")).closeCode).toBe(1000);
		state.getSession.mockResolvedValue(null);
		expect((await connect("visible")).status).toBe(401);
		expect(state.handler).toHaveBeenCalledTimes(1);
		expect(state.getSession).toHaveBeenCalledTimes(2);
	});

	it("closes only an oversized sender and keeps later terminal connections usable", async () => {
		const closed = vi.fn();
		state.handler.mockImplementation((socket) => {
			socket.once("close", closed);
			sendJson(socket, { type: "ready" });
		});
		const code = await new Promise<number>((resolve, reject) => {
			const socket = new WebSocket(`${origin.replace("http:", "ws:")}/ws/terminal`, {
				headers: { origin, cookie: "member" },
			});
			socket.once("message", () => socket.send("x".repeat(70 * 1024)));
			socket.once("close", resolve);
			socket.once("error", reject);
		});
		expect(code).toBe(1009);
		await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
		state.handler.mockImplementation((socket) => {
			sendJson(socket, { type: "ready" });
			socket.close(1000);
		});
		expect((await connect("visible")).closeCode).toBe(1000);
	});

	it("closes a handler that throws synchronously without affecting later sockets", async () => {
		state.handler.mockImplementation(() => {
			throw new Error("Terminal setup failed");
		});
		expect((await connect("visible")).closeCode).toBe(1011);
	});
});
