import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PIPELINE_EXIT_MARKER } from "./pipeline";

/**
 * Runner end-to-end with mocked boundaries: exec (docker), the drizzle
 * client and the destination (local disk in a temp dir). Asserts the
 * `backup_run` transitions and the on-disk layout of a local destination.
 */

const state = vi.hoisted(() => ({
	inserted: [] as Array<Record<string, unknown>>,
	updates: [] as Array<Record<string, unknown>>,
	execCalls: [] as string[],
	execImpl: (async () => "") as (command: string) => Promise<string>,
	configDir: "",
	destination: null as Record<string, unknown> | null,
}));

vi.mock("../../db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db")>();
	const chain = (result: () => unknown) => {
		const proxy: Record<string | symbol, unknown> = new Proxy(
			{},
			{
				get(_target, prop) {
					if (prop === "then") {
						return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
							Promise.resolve().then(result).then(resolve, reject);
					}
					return () => proxy;
				},
			},
		);
		return proxy;
	};
	const db = {
		query: {
			destinations: { findFirst: async () => state.destination },
			applications: { findFirst: async () => ({ serverId: null }) },
			compose: { findFirst: async () => null },
		},
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				state.inserted.push(values);
				return { returning: async () => [{ backupRunId: "run-1" }] };
			},
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					state.updates.push(values);
				},
			}),
		}),
		select: () => chain(() => []),
		delete: () => ({ where: async () => {} }),
	};
	return { ...actual, db, client: vi.fn() };
});
vi.mock("../../utils/exec", () => ({
	execAsync: (command: string) => {
		state.execCalls.push(command);
		return state.execImpl(command);
	},
	execAsyncRemote: (_serverId: string, command: string) => {
		state.execCalls.push(command);
		return state.execImpl(command);
	},
	execAsyncWithStdin: (command: string) => {
		state.execCalls.push(command);
		return state.execImpl(command);
	},
}));
vi.mock("../notifications", () => ({ notifyEvent: vi.fn(async () => {}) }));
vi.mock("../traefik/paths", () => ({ getConfigDir: () => state.configDir }));

import { runVolumeBackup, type VolumeBackupRow } from "./runner";

const volumeBackup: VolumeBackupRow = {
	volumeBackupId: "vb-1",
	name: "data",
	volumeName: "app_data",
	serviceType: "application",
	cronExpression: "0 0 * * *",
	enabled: true,
	prefix: "volume-backup",
	keepLatestCount: null,
	destinationId: "d1",
	applicationId: "app-1",
	composeId: null,
	lastRunAt: null,
	createdAt: new Date(),
};

const archive = gzipSync(Buffer.from("hello volume"));
const encodedArchive = `${archive.toString("base64")}\n${PIPELINE_EXIT_MARKER}0\n`;

beforeEach(async () => {
	state.configDir = await mkdtemp(path.join(tmpdir(), "nixploy-runner-"));
	state.inserted = [];
	state.updates = [];
	state.execCalls = [];
	state.destination = {
		destinationId: "d1",
		name: "disk",
		provider: "local",
		accessKey: "local",
		secretAccessKey: "local",
		bucket: "local",
		region: "local",
		endpoint: "local",
		organizationId: "org-1",
		createdAt: new Date(),
	};
	state.execImpl = async (command) => {
		if (command.startsWith("docker volume inspect")) return "app_data\n";
		if (command.includes("tar czf")) return encodedArchive;
		throw new Error(`unexpected command: ${command}`);
	};
});

afterEach(async () => {
	await rm(state.configDir, { recursive: true, force: true });
});

describe("runVolumeBackup", () => {
	it("records running → success and writes the archive under <config>/backups/<org>/<key>", async () => {
		const result = await runVolumeBackup(volumeBackup, { trigger: "schedule" });
		expect(result.bytes).toBe(archive.length);
		expect(result.key).toMatch(/^volume-backup\/app_data\/\d{4}-\d{2}-\d{2}T[\d-]+Z\.gz$/);

		expect(state.inserted).toEqual([
			expect.objectContaining({
				kind: "volume",
				volumeBackupId: "vb-1",
				backupId: null,
				organizationId: "org-1",
				destinationId: "d1",
				trigger: "schedule",
				status: "running",
			}),
		]);
		expect(state.updates).toEqual([
			expect.objectContaining({
				status: "success",
				bytes: archive.length,
				objectKey: result.key,
				finishedAt: expect.any(Date),
			}),
		]);

		const dir = path.join(state.configDir, "backups", "org-1", "volume-backup", "app_data");
		expect(await readdir(dir)).toEqual([path.basename(result.key)]);
		// The volume must exist before anything is archived.
		expect(state.execCalls[0]).toBe("docker volume inspect 'app_data' --format '{{.Name}}'");
		expect(state.execCalls[1]).toContain(
			"docker run --rm -v 'app_data:/volume-data' alpine sh -c 'tar czf - -C /volume-data .'",
		);
	});

	it("records error (with the message) when the volume does not exist", async () => {
		state.execImpl = async () => {
			throw new Error("Command failed: docker volume inspect\nno such volume");
		};
		await expect(runVolumeBackup(volumeBackup)).rejects.toThrow(
			"Volume app_data does not exist on the target server",
		);
		expect(state.inserted[0]).toMatchObject({ status: "running", trigger: "manual" });
		expect(state.updates).toEqual([
			expect.objectContaining({
				status: "error",
				error: "Volume app_data does not exist on the target server",
			}),
		]);
	});

	it("fails the run when the producer exits non-zero instead of storing an empty archive", async () => {
		state.execImpl = async (command) => {
			if (command.startsWith("docker volume inspect")) return "app_data\n";
			return `${gzipSync(Buffer.alloc(0)).toString("base64")}\n${PIPELINE_EXIT_MARKER}2\n`;
		};
		await expect(runVolumeBackup(volumeBackup)).rejects.toThrow(/exited with status 2/);
		expect(state.updates[0]).toMatchObject({ status: "error" });
		await expect(readdir(path.join(state.configDir, "backups"))).rejects.toThrow();
	});

	it("does not start a run for a missing destination or a protected volume", async () => {
		state.destination = null;
		await expect(runVolumeBackup(volumeBackup)).rejects.toThrow("Destination not found: d1");
		await expect(
			runVolumeBackup({ ...volumeBackup, volumeName: "nixploy-postgres-data" }),
		).rejects.toThrow(/platform volume/);
		expect(state.inserted).toEqual([]);
	});
});
