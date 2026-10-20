import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	node: vi.fn(),
	getDocker: vi.fn(),
	service: vi.fn(),
	volume: vi.fn(),
	list: vi.fn(),
	tasks: vi.fn(),
	container: vi.fn(),
	removeVolume: vi.fn(),
	createVolume: vi.fn(),
}));
vi.mock("../databases/placement", () => ({ databaseSwarmNodeId: mocks.node }));
vi.mock("../deployment/docker", () => ({ getDocker: mocks.getDocker }));

import {
	assertRecoveryRuntimeIdentity,
	inspectRecoveryRuntime,
	provisionRecoveryVolume,
	removeOriginalRecoveryVolume,
} from "./recovery-copy-identity";

const nodeId = "a".repeat(25);
const otherNode = "b".repeat(25);
const containerId = "c".repeat(64);
function fixture() {
	return {
		origin: {
			recoveryCopyId: "copy-id",
			originServerId: null as string | null,
			originSwarmNodeId: nodeId,
			originAppName: "recovery-identity-proof",
			originVolumeName: "recovery-identity-proof-data",
			originVolumeCreatedAt: "2026-10-20T12:00:00Z" as string | null,
		},
		service: {
			ID: "service-id",
			Spec: {
				Name: "recovery-identity-proof",
				Labels: { "nixploy.managed": "true", "nixploy.service.type": "postgres" },
				Mode: { Replicated: { Replicas: 1 } },
				TaskTemplate: {
					Placement: { Constraints: [`node.id==${nodeId}`] },
					ContainerSpec: {
						Mounts: [
							{
								Type: "volume",
								Source: "recovery-identity-proof-data",
								Target: "/var/lib/postgresql/data",
							},
						],
					},
				},
				EndpointSpec: { Ports: [] as unknown[] },
			},
		},
		tasks: [
			{
				ID: "task-id",
				ServiceID: "service-id",
				NodeID: nodeId,
				DesiredState: "running",
				Status: { State: "running", ContainerStatus: { ContainerID: containerId } },
			},
		],
		containers: [
			{
				Id: containerId,
				Config: {
					Labels: {
						"com.docker.swarm.task.id": "task-id",
						"com.docker.swarm.service.id": "service-id",
						"com.docker.swarm.service.name": "recovery-identity-proof",
						"com.docker.swarm.node.id": nodeId,
					},
				},
				State: { Running: true },
				Mounts: [
					{
						Type: "volume",
						Name: "recovery-identity-proof-data",
						Destination: "/var/lib/postgresql/data",
						RW: true,
					},
				],
			},
		],
		volume: {
			CreatedAt: "2026-10-20T12:00:00Z",
			Name: "recovery-identity-proof-data",
			Driver: "local",
			Scope: "local",
			Labels: { "nixploy.managed": "true", "nixploy.recovery.copy": "copy-id" },
		},
		restoreContainerId: containerId,
	};
}

function first<T>(rows: T[]): T {
	const row = rows[0];
	if (!row) throw new Error("Fixture row missing");
	return row;
}

type IdentityFixture = ReturnType<typeof fixture>;
describe("recovery runtime identity", () => {
	it("accepts the private service only with matching node, task, full container identity and named volume", () => {
		expect(() => assertRecoveryRuntimeIdentity(fixture())).not.toThrow();
	});
	it.each<[string, (f: IdentityFixture) => void]>([
		[
			"a manager role pin",
			(f) => {
				f.service.Spec.TaskTemplate.Placement.Constraints = ["node.role==manager"];
			},
		],
		[
			"another manager pin",
			(f) => {
				f.service.Spec.TaskTemplate.Placement.Constraints = [`node.id==${otherNode}`];
			},
		],
		[
			"another task node",
			(f) => {
				first(f.tasks).NodeID = otherNode;
			},
		],
		[
			"an orphaned task",
			(f) => {
				first(f.tasks).Status.State = "orphaned";
			},
		],
		[
			"a reused service name",
			(f) => {
				f.service.ID = "replacement-service-id";
			},
		],
		[
			"another task label",
			(f) => {
				first(f.containers).Config.Labels["com.docker.swarm.task.id"] = "other-task";
			},
		],
		[
			"another container identity",
			(f) => {
				first(f.tasks).Status.ContainerStatus.ContainerID = "d".repeat(64);
			},
		],
		[
			"another container node label",
			(f) => {
				first(f.containers).Config.Labels["com.docker.swarm.node.id"] = otherNode;
			},
		],
		[
			"an anonymous or different mounted volume",
			(f) => {
				first(first(f.containers).Mounts).Name = "different-volume";
			},
		],
		[
			"a different service mount",
			(f) => {
				first(f.service.Spec.TaskTemplate.ContainerSpec.Mounts).Source = "different-volume";
			},
		],
		[
			"an unowned volume",
			(f) => {
				f.volume.Labels["nixploy.managed"] = "false";
			},
		],
		[
			"a nonlocal volume driver",
			(f) => {
				f.volume.Driver = "nfs";
			},
		],
		[
			"a stopped container",
			(f) => {
				first(f.containers).State.Running = false;
			},
		],
		[
			"a published recovery port",
			(f) => {
				f.service.Spec.EndpointSpec.Ports = [{ PublishedPort: 5432 }];
			},
		],
	])("rejects %s before restore", (_name, mutate) => {
		const input = fixture();
		mutate(input);
		expect(() => assertRecoveryRuntimeIdentity(input)).toThrow("does not match");
	});
	it("permits stopped cleanup only on the recorded node, including terminal tasks", () => {
		const input = fixture();
		input.service.Spec.Mode.Replicated.Replicas = 0;
		first(input.tasks).Status.State = "shutdown";
		first(input.tasks).DesiredState = "shutdown";
		first(input.containers).State.Running = false;
		expect(() =>
			assertRecoveryRuntimeIdentity({ ...input, restoreContainerId: undefined }),
		).not.toThrow();
		first(input.tasks).NodeID = otherNode;
		expect(() =>
			assertRecoveryRuntimeIdentity({ ...input, restoreContainerId: undefined }),
		).toThrow("does not match");
	});
	it("permits cleanup of known unassigned pending tasks under the exact origin pin, but cannot restore into them", () => {
		const input = fixture();
		const task = { ID: "pending-task", ServiceID: input.service.ID, Status: { State: "pending" } };
		const pending = { ...input, tasks: [task], containers: [], restoreContainerId: undefined };
		expect(() => assertRecoveryRuntimeIdentity(pending)).not.toThrow();
		expect(() =>
			assertRecoveryRuntimeIdentity({ ...pending, restoreContainerId: containerId }),
		).toThrow("does not match");
		expect(() =>
			assertRecoveryRuntimeIdentity({
				...pending,
				tasks: [{ ...task, Status: { State: "unknown" } }],
			}),
		).toThrow("does not match");
		expect(() =>
			assertRecoveryRuntimeIdentity({
				...pending,
				tasks: [
					{ ...task, Status: { State: "pending", ContainerStatus: { ContainerID: containerId } } },
				],
			}),
		).toThrow("does not match");
	});
});

describe("actual daemon inspection routing", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		const f = fixture();
		mocks.node.mockResolvedValue(nodeId);
		mocks.getDocker.mockImplementation(async (serverId?: string | null) =>
			serverId === "remote-server"
				? {
						createVolume: mocks.createVolume,
						getVolume: () => ({ inspect: mocks.volume, remove: mocks.removeVolume }),
						listContainers: mocks.list,
						getContainer: () => ({ inspect: mocks.container }),
					}
				: {
						createVolume: mocks.createVolume,
						getService: () => ({ inspect: mocks.service }),
						listTasks: mocks.tasks,
						getVolume: () => ({ inspect: mocks.volume, remove: mocks.removeVolume }),
						listContainers: mocks.list,
						getContainer: () => ({ inspect: mocks.container }),
					},
		);
		mocks.service.mockResolvedValue(f.service);
		mocks.tasks.mockResolvedValue(f.tasks);
		mocks.volume.mockResolvedValue(f.volume);
		mocks.list.mockResolvedValue([{ Id: containerId }]);
		mocks.container.mockResolvedValue(f.containers[0]);
	});
	it("resolves the short readiness ID to one inspected full container ID", async () => {
		await expect(
			inspectRecoveryRuntime(fixture().origin, containerId.slice(0, 12)),
		).resolves.toMatchObject({ containerId });
	});
	it("creates and verifies copy-labeled storage before a fresh service can start", async () => {
		mocks.service.mockRejectedValue({ statusCode: 404 });
		mocks.list.mockResolvedValue([]);
		mocks.volume.mockRejectedValue({ statusCode: 404 });
		mocks.createVolume.mockImplementation(async () => {
			mocks.volume.mockResolvedValue(fixture().volume);
		});
		await expect(
			provisionRecoveryVolume({ ...fixture().origin, originVolumeCreatedAt: null }),
		).resolves.toBe(fixture().volume.CreatedAt);
		expect(mocks.createVolume).toHaveBeenCalledWith({
			Name: fixture().origin.originVolumeName,
			Driver: "local",
			Labels: { "nixploy.managed": "true", "nixploy.recovery.copy": "copy-id" },
		});
	});
	it("refuses existing named storage without creating, mounting or removing it", async () => {
		mocks.service.mockRejectedValue({ statusCode: 404 });
		mocks.list.mockResolvedValue([]);
		await expect(
			provisionRecoveryVolume({ ...fixture().origin, originVolumeCreatedAt: null }),
		).rejects.toThrow("name already exists");
		expect(mocks.createVolume).not.toHaveBeenCalled();
		expect(mocks.removeVolume).not.toHaveBeenCalled();
	});
	it("fails closed if Docker createVolume reused a racing foreign volume", async () => {
		mocks.service.mockRejectedValue({ statusCode: 404 });
		mocks.list.mockResolvedValue([]);
		mocks.volume.mockRejectedValue({ statusCode: 404 });
		mocks.createVolume.mockImplementation(async () => {
			const v = fixture().volume;
			v.Labels["nixploy.recovery.copy"] = "foreign-copy";
			mocks.volume.mockResolvedValue(v);
		});
		await expect(
			provisionRecoveryVolume({ ...fixture().origin, originVolumeCreatedAt: null }),
		).rejects.toThrow("does not match");
		expect(mocks.removeVolume).not.toHaveBeenCalled();
	});
	it("rejects a changed/rejoined daemon before inspecting or removing any resource", async () => {
		mocks.node.mockResolvedValue(otherNode);
		await expect(inspectRecoveryRuntime(fixture().origin)).rejects.toThrow("daemon has changed");
		expect(mocks.getDocker).not.toHaveBeenCalled();
	});
	it("reads cluster tasks on the primary and storage only on the recorded remote daemon", async () => {
		const origin = { ...fixture().origin, originServerId: "remote-server" };
		await expect(inspectRecoveryRuntime(origin, containerId)).resolves.toMatchObject({
			serviceExists: true,
			volumeExists: true,
		});
		expect(mocks.node).toHaveBeenCalledWith("remote-server");
		expect(mocks.getDocker).toHaveBeenNthCalledWith(1);
		expect(mocks.getDocker).toHaveBeenNthCalledWith(2, "remote-server");
	});
	it("verifies absence only after proving the original daemon identity", async () => {
		mocks.service.mockRejectedValue({ statusCode: 404 });
		mocks.volume.mockRejectedValue({ statusCode: 404 });
		mocks.list.mockResolvedValue([]);
		await expect(inspectRecoveryRuntime(fixture().origin)).resolves.toEqual({
			serviceExists: false,
			volumeExists: false,
		});
	});
	it("does not mistake an unreachable daemon or API failure for absence", async () => {
		mocks.volume.mockRejectedValue(new Error("connection lost"));
		await expect(inspectRecoveryRuntime(fixture().origin)).rejects.toThrow("connection lost");
	});
	it("refuses a leftover container after its service disappears", async () => {
		mocks.service.mockRejectedValue({ statusCode: 404 });
		await expect(inspectRecoveryRuntime(fixture().origin)).rejects.toThrow("does not match");
	});
	it("retries a partial teardown only for the same labeled volume creation on its original node", async () => {
		mocks.service.mockRejectedValue({ statusCode: 404 });
		mocks.list.mockResolvedValue([]);
		mocks.removeVolume.mockImplementation(async () => {
			mocks.volume.mockRejectedValue({ statusCode: 404 });
		});
		await removeOriginalRecoveryVolume(fixture().origin);
		expect(mocks.removeVolume).toHaveBeenCalledTimes(1);
	});
	it.each(["creation", "label", "legacy"])(
		"refuses a reused or unknown %s volume without removing it",
		async (field) => {
			mocks.service.mockRejectedValue({ statusCode: 404 });
			mocks.list.mockResolvedValue([]);
			const f = fixture();
			if (field === "creation") f.volume.CreatedAt = "2026-10-20T13:00:00Z";
			if (field === "label") f.volume.Labels["nixploy.recovery.copy"] = "other-copy";
			if (field === "legacy") f.origin.originVolumeCreatedAt = null;
			mocks.volume.mockResolvedValue(f.volume);
			await expect(removeOriginalRecoveryVolume(f.origin)).rejects.toThrow("does not match");
			expect(mocks.removeVolume).not.toHaveBeenCalled();
		},
	);
});
