import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeploymentContext } from "./context";

const mock = vi.hoisted(() => ({
	create: vi.fn(),
	remove: vi.fn(async () => {}),
	inspect: vi.fn(),
	getContainer: vi.fn(),
	getDocker: vi.fn(),
	exec: vi.fn(async () => ""),
	remoteExec: vi.fn(async () => ""),
}));
vi.mock("./docker", async (original) => ({
	...(await original<typeof import("./docker")>()),
	getDocker: mock.getDocker,
}));
vi.mock("../../utils/exec", () => ({ execAsync: mock.exec, execAsyncRemote: mock.remoteExec }));

import { CommandError } from "./docker";
import { DEPLOYMENT_HOOK_OWNER_LABEL, hookOwnershipToken } from "./hook-ownership";
import { DEPLOYMENT_HOOK_LABEL, runPostDeployHook, runPreDeployHook } from "./hooks";

const input = {
	appName: "owned",
	deploymentId: "full-job",
	image: "nginx:alpine",
	network: "owned-net",
	env: 'GREETING="hello world"\nMULTI="one\\ntwo"',
	command: "exit 3",
};
const context = () =>
	({
		serverId: null,
		run: vi.fn(async () => {}),
		logger: { line: vi.fn() },
		step: vi.fn(),
	}) as unknown as DeploymentContext;
beforeEach(() => {
	vi.clearAllMocks();
	mock.create.mockResolvedValue({ id: "a".repeat(64), remove: mock.remove });
	mock.remove.mockResolvedValue(undefined);
	mock.inspect.mockResolvedValue({
		Id: "a".repeat(64),
		Name: "/owned-hook-fulljob",
		HostConfig: { AutoRemove: true },
		Config: {
			Entrypoint: ["sh"],
			Labels: {
				[DEPLOYMENT_HOOK_LABEL]: input.deploymentId,
				[DEPLOYMENT_HOOK_OWNER_LABEL]: hookOwnershipToken(
					input.deploymentId,
					"owned-hook-fulljob",
					null,
				),
			},
		},
	});
	mock.getContainer.mockReturnValue({ inspect: mock.inspect, remove: mock.remove });
	mock.getDocker.mockResolvedValue({
		createContainer: mock.create,
		getContainer: mock.getContainer,
	});
	mock.exec.mockResolvedValue("");
});
describe("pre-deploy lifecycle", () => {
	it("sends exact env through local Engine API and attaches only the opaque created ID", async () => {
		const ctx = context();
		await runPreDeployHook(ctx, input);
		expect(mock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				Env: ["GREETING=hello world", "MULTI=one\ntwo"],
				Entrypoint: ["sh"],
				Cmd: ["-c", "exit 3"],
			}),
		);
		expect(ctx.run).toHaveBeenCalledWith(`docker start -a '${"a".repeat(64)}'`, {
			timeoutMs: expect.any(Number),
		});
		expect(mock.remove).toHaveBeenCalledWith({ force: true, v: true });
	});
	it("uses the managed server transport and preserves nonzero and cancelled failure shapes", async () => {
		const ctx = context();
		ctx.serverId = "owned-remote";
		vi.mocked(ctx.run).mockRejectedValue(new CommandError("Command failed (exit 3)", 3, false));
		await expect(runPreDeployHook(ctx, input)).rejects.toThrow(/exit 3/);
		expect(mock.getDocker).toHaveBeenCalledWith("owned-remote");
		expect(mock.remove).toHaveBeenCalledOnce();
		const cancelled = new CommandError("cancelled", null, true);
		vi.mocked(ctx.run).mockRejectedValue(cancelled);
		await expect(runPreDeployHook(ctx, input)).rejects.toBe(cancelled);
	});
	it("removes a late created container when ctx.run rejects cancellation before spawning", async () => {
		let resolveCreate: (value: unknown) => void = () => {};
		mock.create.mockReturnValue(
			new Promise((resolve) => {
				resolveCreate = resolve;
			}),
		);
		const ctx = context();
		const cancelled = new CommandError("cancelled", null, true);
		vi.mocked(ctx.run).mockRejectedValue(cancelled);
		const running = runPreDeployHook(ctx, input);
		const observed = expect(running).rejects.toBe(cancelled);
		await Promise.resolve();
		resolveCreate({ id: "late-owned", remove: mock.remove });
		await observed;
		expect(mock.remove).toHaveBeenCalledOnce();
	});
	it("retries a 404 create race and removes the later owned container", async () => {
		mock.create.mockRejectedValue(new Error("connection lost"));
		mock.inspect.mockRejectedValueOnce({ statusCode: 404 });
		await expect(runPreDeployHook(context(), input)).rejects.toThrow(/connection lost/);
		expect(mock.inspect).toHaveBeenCalledTimes(2);
		expect(mock.remove).toHaveBeenCalledOnce();
	});

	it("never removes an unowned name collision after create failed", async () => {
		mock.create.mockRejectedValue(new Error("name conflict"));
		mock.inspect.mockResolvedValue({
			Config: { Labels: { [DEPLOYMENT_HOOK_LABEL]: "other-job" } },
		});
		await expect(runPreDeployHook(context(), input)).rejects.toThrow(/name conflict/);
		expect(mock.remove).not.toHaveBeenCalled();
	});
	it("cleans a matching owned container if the create response was lost", async () => {
		mock.create.mockRejectedValue(new Error("connection lost"));
		await expect(runPreDeployHook(context(), input)).rejects.toThrow(/connection lost/);
		expect(mock.remove).toHaveBeenCalledWith({ force: true, v: true });
	});
});
it("post-deploy lookup requires the new deployment revision as well as service ownership", async () => {
	mock.exec.mockResolvedValue("b".repeat(64));
	const ctx = context();
	await runPostDeployHook(ctx, { appName: "owned", deploymentId: "new-job", command: "true" });
	expect(mock.exec).toHaveBeenCalledWith(
		expect.stringContaining("--filter 'label=io.nixploy.deployment-revision=new-job'"),
	);
	expect(mock.exec).toHaveBeenCalledWith(
		expect.stringContaining("--filter 'label=com.docker.swarm.service.name=owned'"),
	);
});
