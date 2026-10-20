import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	role: "all",
	resolveSockets: () => {},
	sockets: Promise.resolve(0),
	closeSsh: vi.fn(),
	migrateEnv: vi.fn(async () => ({ migrated: 0 })),
	drainQueue: vi.fn(async () => ({ completed: 0, interrupted: 0 })),
	stopBridge: vi.fn(async () => {}),
	http: { close: vi.fn(), closeIdleConnections: vi.fn(), listen: vi.fn() },
}));

vi.mock("node:http", () => ({ createServer: () => state.http }));
vi.mock("next", () => ({
	default: () => ({ prepare: async () => {}, getRequestHandler: () => vi.fn() }),
}));
vi.mock("@nixploy/server/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@nixploy/server/ws", () => ({
	setupWebSocketServer: vi.fn(),
	closeWebSocketServer: () => state.sockets,
}));
vi.mock("../../../../packages/server/src/lib/auth", () => ({ initAuth: async () => {} }));
vi.mock("../../../../packages/server/src/lib/role", () => ({
	DEFAULT_WORKER_PORT: 3001,
	describeProcessRole: () => state.role,
	isUnknownProcessRole: () => false,
	isWorkerRole: () => state.role === "all",
	processRole: () => state.role,
}));
vi.mock("../../../../packages/server/src/lib/shutdown", () => ({
	shutdownGraceMs: () => 60_000,
	stopScheduledJobs: async () => ({ jobs: 0, timedOut: false }),
}));
vi.mock("../../../../packages/server/src/modules/auth/sso-notify", () => ({
	startAuthRebuildBridge: async () => {},
}));
vi.mock("../../../../packages/server/src/modules/deployment/notify", () => ({
	startEventBridge: async () => {},
	stopEventBridge: state.stopBridge,
}));
vi.mock("../../../../packages/server/src/modules/deployment/queue", () => ({
	drainQueue: state.drainQueue,
}));
vi.mock("../../../../packages/server/src/modules/projects/organization-env", () => ({
	migrateOrganizationEnvironments: state.migrateEnv,
}));
vi.mock("../../../../packages/server/src/utils/ssh-pool", () => ({
	closeAllSshConnections: state.closeSsh,
}));
vi.mock("../../../../packages/server/src/utils/rate-limit", () => ({
	PEER_IP_HEADER: "x-nixploy-peer-ip",
}));
vi.mock("../../worker", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../worker")>()),
	startBackgroundWork: async () => {},
}));

const listeners = new Map<string, () => void>();
let shutdownStarted = false;

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	listeners.clear();
	shutdownStarted = false;
	state.sockets = new Promise<number>((resolve) => {
		state.resolveSockets = () => resolve(1);
	});
	vi.spyOn(process, "on").mockImplementation((event, listener) => {
		listeners.set(String(event), listener as () => void);
		return process;
	});
	vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(async () => {
	state.resolveSockets();
	if (shutdownStarted) {
		await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
	}
	vi.restoreAllMocks();
});

describe("process shutdown keeps SSH available for terminal cleanup", () => {
	it("does not accept HTTP work until encrypted-variable backfill finishes", async () => {
		let finish = () => {};
		state.migrateEnv.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ migrated: 1 });
				}),
		);
		await import("../../server");
		expect(state.migrateEnv).toHaveBeenCalledOnce();
		expect(state.http.listen).not.toHaveBeenCalled();
		finish();
		await vi.waitFor(() => expect(state.http.listen).toHaveBeenCalledOnce());
	});

	it.each(["all", "panel"])(
		"fences pool closure in role %s even with an idle queue",
		async (role) => {
			state.role = role;
			await import("../../server");
			await vi.waitFor(() => expect(state.http.listen).toHaveBeenCalledOnce());
			shutdownStarted = true;
			listeners.get("SIGTERM")?.();
			if (role === "all") {
				await vi.waitFor(() => expect(state.stopBridge).toHaveBeenCalledOnce());
				expect(state.drainQueue).toHaveBeenCalledOnce();
			} else {
				expect(state.drainQueue).not.toHaveBeenCalled();
			}
			expect(state.http.close).toHaveBeenCalledOnce();
			expect(state.closeSsh).not.toHaveBeenCalled();
			expect(process.exit).not.toHaveBeenCalled();
			state.resolveSockets();
			await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
			expect(state.closeSsh).toHaveBeenCalledOnce();
		},
	);

	it("still closes the pool when a standalone worker drains", async () => {
		const { stopBackgroundWork } = await import("../../worker");
		await stopBackgroundWork(1_000);
		expect(state.drainQueue).toHaveBeenCalledWith({ graceMs: 1_000 });
		expect(state.closeSsh).toHaveBeenCalledOnce();
	});
});
