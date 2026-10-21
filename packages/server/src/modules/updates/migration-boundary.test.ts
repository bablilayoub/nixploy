import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The production runner is a native Node ES module with lazy runtime dependencies.
const { assertPlatformDrained, prepareUpgradeBoundary } = await import(
	new URL("../../../../../docker/migrate.mjs", import.meta.url).href
);
const folders: string[] = [];
afterEach(async () => {
	await Promise.all(
		folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
	);
});

function engine(
	overrides: { replicas?: number; state?: string; node?: string; worker?: boolean } = {},
) {
	const names = overrides.worker === false ? ["nixploy"] : ["nixploy", "nixploy-worker"];
	return vi.fn(async (args: string[]) => {
		if (args[0] === "info")
			return JSON.stringify({ LocalNodeState: "active", ControlAvailable: true });
		if (args[0] === "service" && args[1] === "ls") return names.join("\n");
		if (args[0] === "service" && args[1] === "inspect") {
			return JSON.stringify(
				names.map((name) => ({
					ID: name,
					Spec: { Mode: { Replicated: { Replicas: overrides.replicas ?? 0 } } },
				})),
			);
		}
		if (args[0] === "service" && args[1] === "ps") return "old-task";
		if (args[0] === "inspect")
			return JSON.stringify([
				{
					ID: "old-task",
					ServiceID: "nixploy",
					NodeID: "node",
					DesiredState: "shutdown",
					Status: { State: overrides.state ?? "shutdown" },
				},
			]);
		if (args[0] === "node")
			return JSON.stringify([
				{
					ID: "node",
					Status: { State: overrides.node ?? "ready" },
					ManagerStatus: { Reachability: "reachable" },
				},
			]);
		throw new Error("Unexpected Docker operation");
	});
}

async function database(legacy = true) {
	const folder = await mkdtemp(join(tmpdir(), "nixploy-migration-boundary-"));
	folders.push(folder);
	await mkdir(join(folder, "meta"));
	await writeFile(
		join(folder, "meta/_journal.json"),
		JSON.stringify({ entries: [{ tag: "0048_boundary" }] }),
	);
	const client = { unsafe: vi.fn(async (_query: string) => [{ legacy, encrypted: !legacy }]) };
	return { folder, client };
}

describe("encrypted-storage upgrade boundary", () => {
	it("rejects an old GUI roll before setting migration permission or touching Docker", async () => {
		const { folder, client } = await database();
		const runDocker = engine();
		await expect(
			prepareUpgradeBoundary(client, folder, { acknowledgement: "", runDocker }),
		).rejects.toThrow(/host update.sh/);
		expect(client.unsafe).toHaveBeenCalledTimes(1);
		expect(runDocker).not.toHaveBeenCalled();
	});
	it("sets permission on the migration session only after every old role has stopped", async () => {
		const { folder, client } = await database();
		await expect(
			prepareUpgradeBoundary(client, folder, { acknowledgement: "0048", runDocker: engine() }),
		).resolves.toBe(true);
		expect(client.unsafe.mock.calls[1]?.[0]).toBe(
			"select set_config('nixploy.upgrade_0048_drained','1',false)",
		);
	});
	it.each(["running", "starting", "orphaned", "unknown"])(
		"rejects actual %s tasks despite desired shutdown",
		async (state) => {
			await expect(assertPlatformDrained(engine({ state }))).rejects.toThrow(/old platform task/);
		},
	);
	it("rejects zero tasks on an unreachable node", async () => {
		await expect(assertPlatformDrained(engine({ node: "down" }))).rejects.toThrow(/unreachable/);
	});
	it("rejects a role that can schedule another replica", async () => {
		await expect(assertPlatformDrained(engine({ replicas: 1 }))).rejects.toThrow(/Stop every/);
	});
	it("supports an explicitly confirmed single-process install", async () => {
		await expect(assertPlatformDrained(engine({ worker: false }))).resolves.toEqual({
			services: 1,
			tasks: 1,
		});
	});
	it("does not require a transition token after this boundary is already committed", async () => {
		const { folder, client } = await database(false);
		const runDocker = engine();
		await expect(
			prepareUpgradeBoundary(client, folder, { acknowledgement: "", runDocker }),
		).resolves.toBe(false);
		expect(runDocker).not.toHaveBeenCalled();
		expect(client.unsafe).toHaveBeenCalledTimes(1);
	});
});
