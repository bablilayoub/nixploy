import type Docker from "dockerode";
import { beforeEach, expect, it, vi } from "vitest";
import {
	DEPLOYMENT_HOOK_LABEL,
	DEPLOYMENT_HOOK_OWNER_LABEL,
	hookOwnershipToken,
	ownedDeploymentHook,
} from "./hook-ownership";

const mock = vi.hoisted(() => ({
	servers: vi.fn(async () => [] as Array<{ serverId: string }>),
	job: vi.fn(),
	list: vi.fn(),
	inspect: vi.fn(),
	remove: vi.fn(async () => {}),
	getDocker: vi.fn(),
}));
vi.mock("../../db", () => ({
	db: { query: { servers: { findMany: mock.servers }, deployments: { findFirst: mock.job } } },
}));
vi.mock("./docker", () => ({ getDocker: mock.getDocker }));

import { pruneDeploymentHookContainers } from "./hooks-cleanup";

const fullId = "a".repeat(64),
	name = "app-hook-fulljob",
	jobId = "job-owned";
const owned = (serverId: string | null = null) =>
	({
		Id: fullId,
		Name: `/${name}`,
		HostConfig: { AutoRemove: true },
		Config: {
			Entrypoint: ["sh"],
			Labels: {
				[DEPLOYMENT_HOOK_LABEL]: jobId,
				[DEPLOYMENT_HOOK_OWNER_LABEL]: hookOwnershipToken(jobId, name, serverId),
			},
		},
	}) as unknown as Docker.ContainerInspectInfo;
beforeEach(() => {
	vi.clearAllMocks();
	mock.servers.mockResolvedValue([]);
	mock.job.mockResolvedValue({ status: "error" });
	mock.list.mockResolvedValue([{ Id: fullId }]);
	mock.inspect.mockResolvedValue(owned());
	mock.getDocker.mockResolvedValue({
		listContainers: mock.list,
		getContainer: vi.fn(() => ({ inspect: mock.inspect, remove: mock.remove })),
	});
});
it("recovers an owned created hook after a terminal job, removing exact ID and anonymous volumes", async () => {
	expect(await pruneDeploymentHookContainers()).toBe(1);
	expect(mock.remove).toHaveBeenCalledWith({ force: true, v: true });
	expect(mock.list).toHaveBeenCalledWith({
		all: true,
		filters: { label: [DEPLOYMENT_HOOK_LABEL] },
	});
});
it("also recovers valid ownership after a deployment row was pruned", async () => {
	mock.job.mockResolvedValue(undefined);
	expect(await pruneDeploymentHookContainers()).toBe(1);
});
it.each(["queued", "running"])("preserves an active %s deployment hook", async (status) => {
	mock.job.mockResolvedValue({ status });
	expect(await pruneDeploymentHookContainers()).toBe(0);
	expect(mock.remove).not.toHaveBeenCalled();
});
it("rejects forged labels, another node/instance identity, and Swarm/Compose task containers", async () => {
	const remote = owned("other-node");
	expect(ownedDeploymentHook(remote, null)).toBeNull();
	const forged = owned();
	forged.Config.Labels[DEPLOYMENT_HOOK_OWNER_LABEL] = "0".repeat(64);
	expect(ownedDeploymentHook(forged, null)).toBeNull();
	for (const label of [
		"com.docker.swarm.service.id",
		"com.docker.compose.project",
		"com.docker.stack.namespace",
	]) {
		const task = owned();
		task.Config.Labels[label] = "unrelated";
		expect(ownedDeploymentHook(task, null)).toBeNull();
	}
	mock.inspect.mockResolvedValue(forged);
	expect(await pruneDeploymentHookContainers()).toBe(0);
	expect(mock.remove).not.toHaveBeenCalled();
});
it("never removes a different full identity returned by inspect or an invalid summary ID", async () => {
	mock.inspect.mockResolvedValue({ ...owned(), Id: "b".repeat(64) });
	expect(await pruneDeploymentHookContainers()).toBe(0);
	expect(mock.remove).not.toHaveBeenCalled();
	mock.list.mockResolvedValue([{ Id: "short" }]);
	mock.inspect.mockClear();
	expect(await pruneDeploymentHookContainers()).toBe(0);
	expect(mock.inspect).not.toHaveBeenCalled();
});
