import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	inspect: vi.fn(),
	update: vi.fn(),
	create: vi.fn(),
	tasks: vi.fn(),
	node: vi.fn(),
	origin: vi.fn(),
	target: vi.fn(),
	runtime: vi.fn(),
	remove: vi.fn(),
	volumeInspect: vi.fn(),
	volumeRemove: vi.fn(),
	prune: vi.fn(),
}));
vi.mock("dockerode", () => ({
	default: class Docker {
		getService() {
			return { inspect: mocks.inspect, update: mocks.update, remove: mocks.remove };
		}
		getVolume() {
			return { inspect: mocks.volumeInspect, remove: mocks.volumeRemove };
		}
		listContainers = vi.fn(async () => []);
		createService = mocks.create;
		listTasks = mocks.tasks;
	},
}));
vi.mock("../../db", () => ({
	db: {
		query: {
			environments: { findFirst: async () => null },
			recoveryCopies: { findFirst: mocks.origin },
			postgres: { findFirst: mocks.target },
		},
	},
}));
vi.mock("../deployment/network", () => ({
	ensureEnvironmentNetworkById: async () => "private-environment-network",
	pruneEnvironmentNetwork: mocks.prune,
}));
vi.mock("../backups/recovery-copy-identity", () => ({ inspectRecoveryRuntime: mocks.runtime }));
vi.mock("../runtime-logs/store", () => ({ removeRuntimeLogs: vi.fn() }));
vi.mock("./placement", async (original) => ({
	...(await original<typeof import("./placement")>()),
	databaseSwarmNodeId: mocks.node,
}));

import { deployDatabase, type PostgresRow, removeDatabase } from "./engine";

const nodeId = "a".repeat(25);
const otherNode = "b".repeat(25);
const row = {
	postgresId: "postgres-id",
	name: "Recovery proof",
	appName: "recovery-proof",
	environmentId: "environment-id",
	serverId: null,
	dockerImage: "postgres:17",
	databaseName: "app",
	databaseUser: "app",
	databasePassword: "fixture-only-password",
	env: null,
	command: null,
	externalPort: null,
	memoryReservation: null,
	memoryLimit: null,
	cpuReservation: null,
	cpuLimit: null,
} as PostgresRow;
function service(replicas = 1) {
	return {
		ID: "service-id",
		Version: { Index: 1 },
		Spec: {
			Name: row.appName,
			Labels: { "nixploy.managed": "true", "nixploy.service.type": "postgres" },
			TaskTemplate: { Placement: { Constraints: [`node.id==${nodeId}`] } },
			Mode: { Replicated: { Replicas: replicas } },
		},
	};
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.node.mockResolvedValue(nodeId);
	mocks.origin.mockResolvedValue(undefined);
	mocks.target.mockResolvedValue({ postgresId: row.postgresId });
	mocks.runtime.mockResolvedValue({ serviceExists: true, volumeExists: true });
	mocks.volumeInspect.mockRejectedValue({ statusCode: 404 });
	mocks.inspect.mockRejectedValue({ statusCode: 404 });
	mocks.create.mockResolvedValue({});
	mocks.update.mockResolvedValue({});
	mocks.tasks.mockResolvedValue([{ NodeID: nodeId, Status: { State: "running" } }]);
});

describe("general database removal respects recovery origins", () => {
	const origin = () => ({
		recoveryCopyId: "copy-id",
		originSwarmNodeId: nodeId,
		originServerId: null,
		originAppName: row.appName,
		originVolumeName: `${row.appName}-data`,
		originVolumeCreatedAt: "2026-10-20T12:00:00Z",
	});
	it("directs ordinary database removal to the tracked Delete copy action before infrastructure changes", async () => {
		mocks.origin.mockResolvedValue(origin());
		await expect(removeDatabase(row.appName, null, "postgres", row.environmentId)).rejects.toThrow(
			"Use Delete copy",
		);
		expect(mocks.runtime).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.prune).not.toHaveBeenCalled();
	});
	it("checks concrete runtime identity and actual absence for an explicit copy deletion", async () => {
		mocks.origin.mockResolvedValue(origin());
		mocks.inspect.mockResolvedValue(service());
		mocks.runtime
			.mockResolvedValueOnce({ serviceExists: true, volumeExists: true })
			.mockResolvedValueOnce({ serviceExists: false, volumeExists: false });
		await removeDatabase(row.appName, null, "postgres", row.environmentId, {
			recoveryCopyId: "copy-id",
		});
		expect(mocks.runtime).toHaveBeenCalledWith(origin());
		expect(mocks.remove).toHaveBeenCalledTimes(1);
		expect(mocks.runtime.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.remove.mock.invocationCallOrder[0] ?? 0,
		);
	});
	it("does not remove service, volume or environment network on a changed/rejoined daemon", async () => {
		mocks.origin.mockResolvedValue(origin());
		mocks.runtime.mockRejectedValue(new Error("daemon identity changed"));
		await expect(
			removeDatabase(row.appName, null, "postgres", row.environmentId, {
				recoveryCopyId: "copy-id",
			}),
		).rejects.toThrow("daemon identity changed");
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.volumeRemove).not.toHaveBeenCalled();
		expect(mocks.prune).not.toHaveBeenCalled();
	});
	it.each(["server", "appName", "legacy"])(
		"fails closed for a changed %s via the ordinary remove route",
		async (field) => {
			const changed = {
				...origin(),
				...(field === "server"
					? { originServerId: "original-server" }
					: field === "appName"
						? { originAppName: "original-app" }
						: { originSwarmNodeId: null }),
			};
			mocks.origin.mockResolvedValue(changed);
			await expect(
				removeDatabase(row.appName, null, "postgres", row.environmentId, {
					recoveryCopyId: "copy-id",
				}),
			).rejects.toThrow("immutable storage location");
			expect(mocks.remove).not.toHaveBeenCalled();
			expect(mocks.prune).not.toHaveBeenCalled();
		},
	);
	it("does not remove an orphan volume after its service identity has disappeared", async () => {
		mocks.origin.mockResolvedValue(origin());
		mocks.runtime.mockResolvedValue({ serviceExists: false, volumeExists: true });
		await expect(
			removeDatabase(row.appName, null, "postgres", row.environmentId, {
				recoveryCopyId: "copy-id",
			}),
		).rejects.toThrow("inspect it manually");
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.volumeRemove).not.toHaveBeenCalled();
	});
	it("never returns success when remote teardown silently leaves the original volume", async () => {
		mocks.origin.mockResolvedValue(origin());
		mocks.inspect.mockResolvedValue(service());
		mocks.runtime
			.mockResolvedValueOnce({ serviceExists: true, volumeExists: true })
			.mockResolvedValueOnce({ serviceExists: false, volumeExists: true });
		await expect(
			removeDatabase(row.appName, null, "postgres", row.environmentId, {
				recoveryCopyId: "copy-id",
			}),
		).rejects.toThrow("tracking is retained for retry");
		expect(mocks.remove).toHaveBeenCalledTimes(1);
	});
});

describe("database deployment keeps local volume placement", () => {
	it("creates local databases on the concrete current node", async () => {
		await expect(deployDatabase("postgres", row)).resolves.toEqual({ created: true });
		expect(mocks.node).toHaveBeenCalledWith(null);
		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({
				TaskTemplate: expect.objectContaining({
					Placement: { Constraints: [`node.id==${nodeId}`] },
				}),
			}),
		);
	});
	it("ordinary redeploy preserves the recovery origin pin and stopped replica count", async () => {
		mocks.inspect.mockResolvedValue(service(0));
		mocks.origin.mockResolvedValue({
			recoveryCopyId: "copy-id",
			targetPostgresId: row.postgresId,
			originSwarmNodeId: nodeId,
			originServerId: null,
			originAppName: row.appName,
		});
		await expect(deployDatabase("postgres", row)).resolves.toEqual({ created: false });
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				Mode: { Replicated: { Replicas: 0 } },
				TaskTemplate: expect.objectContaining({
					Placement: { Constraints: [`node.id==${nodeId}`] },
				}),
			}),
		);
		expect(
			mocks.update.mock.calls[0]?.[0].TaskTemplate.ContainerSpec.Mounts[0].VolumeOptions.Labels,
		).toEqual({ "nixploy.managed": "true", "nixploy.recovery.copy": "copy-id" });
	});
	it.each([nodeId, null])(
		"refuses a recovery redeploy on a changed daemon, including an absent service (origin %s)",
		async (originSwarmNodeId) => {
			mocks.node.mockResolvedValue(otherNode);
			mocks.origin.mockResolvedValue({
				targetPostgresId: row.postgresId,
				originSwarmNodeId,
				originServerId: null,
				originAppName: row.appName,
			});
			await expect(deployDatabase("postgres", row)).rejects.toThrow("immutable storage node");
			expect(mocks.update).not.toHaveBeenCalled();
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);
	it("refuses to repin an existing unconstrained database running on another manager", async () => {
		const existing = service();
		existing.Spec.TaskTemplate.Placement.Constraints = [];
		mocks.inspect.mockResolvedValue(existing);
		mocks.tasks.mockResolvedValue([{ NodeID: otherNode, Status: { State: "running" } }]);
		await expect(deployDatabase("postgres", row)).rejects.toThrow("another node");
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it.each([null, "different-postgres-id"])(
		"reserves an undeleted origin name even when its target is %s",
		async (targetPostgresId) => {
			mocks.origin.mockResolvedValue({
				targetPostgresId,
				originAppName: row.appName,
				originServerId: null,
				originSwarmNodeId: nodeId,
			});
			await expect(deployDatabase("postgres", row)).rejects.toThrow("name remains reserved");
			expect(mocks.create).not.toHaveBeenCalled();
			expect(mocks.update).not.toHaveBeenCalled();
			expect(mocks.node).not.toHaveBeenCalled();
		},
	);
	it("reserves recovery data from other database kinds before deployment", async () => {
		mocks.origin.mockResolvedValue({ targetPostgresId: null, originAppName: row.appName });
		await expect(deployDatabase("redis", { ...row, redisId: "redis-id" })).rejects.toThrow(
			"name remains reserved",
		);
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.node).not.toHaveBeenCalled();
	});
});
