import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PIPELINE_EXIT_MARKER } from "./pipeline";
import { LocalBackupStore } from "./storage";

/**
 * Runner end-to-end with mocked boundaries: exec (docker), the drizzle
 * client and the destination (local disk in a temp dir). Asserts the
 * `backup_run` transitions and the on-disk layout of a local destination.
 */

const state = vi.hoisted(() => ({
	inserted: [] as Array<Record<string, unknown>>,
	updates: [] as Array<Record<string, unknown>>,
	execCalls: [] as string[],
	remoteExecCalls: [] as Array<{ serverId: string; command: string }>,
	execImpl: (async () => "") as (command: string) => Promise<string>,
	configDir: "",
	streamImpl: (async () => ({})) as (...args: unknown[]) => Promise<unknown>,
	destination: null as Record<string, unknown> | null,
	volumeServerId: null as string | null,
	tarListing: "",
	readerToken: "",
	linked: {
		serverId: null as string | null,
		databaseUser: "app",
		databasePassword: "test-password",
		dockerImage: "postgres:16-alpine",
	},
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
			applications: { findFirst: async () => ({ serverId: state.volumeServerId }) },
			compose: { findFirst: async () => null },
			postgres: { findFirst: async () => state.linked },
			redis: { findFirst: async () => state.linked },
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
	execAsyncRemote: (serverId: string, command: string) => {
		state.execCalls.push(command);
		state.remoteExecCalls.push({ serverId, command });
		return state.execImpl(command);
	},
	execAsyncWithStdin: (command: string) => {
		state.execCalls.push(command);
		return state.execImpl(command);
	},
}));
vi.mock("./redis-lock", () => ({
	withRedisBackupLock: (_id: string, work: (signal: AbortSignal) => Promise<unknown>) =>
		work(new AbortController().signal),
}));
vi.mock("./stream-exec", () => ({
	spawnStreamingCommand: (_serverId: string | null, command: string, options: unknown) => {
		state.execCalls.push(command);
		return state.streamImpl(command, options);
	},
}));
vi.mock("../notifications", () => ({ notifyEvent: vi.fn(async () => {}) }));
vi.mock("../traefik/paths", () => ({ getConfigDir: () => state.configDir }));

import {
	type BackupRow,
	DEFAULT_DATABASE_READY_TIMEOUT_MS,
	databaseReadyTimeoutMs,
	isDatabaseStartingError,
	restoreBackup,
	restoreVolumeBackup,
	runBackup,
	runVolumeBackup,
	type VolumeBackupRow,
} from "./runner";

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

const backupRow: BackupRow = {
	backupId: "b-1",
	appName: "database",
	schedule: "0 0 * * *",
	enabled: true,
	prefix: "backup",
	database: "app",
	databaseType: "postgres",
	destinationId: "d1",
	keepLatestCount: null,
	postgresId: "pg-1",
	mysqlId: null,
	mariadbId: null,
	mongoId: null,
	redisId: null,
	lastRunAt: null,
	createdAt: new Date(),
};

const archive = gzipSync(Buffer.from("hello volume"));

beforeEach(async () => {
	state.configDir = await mkdtemp(path.join(tmpdir(), "nixploy-runner-"));
	state.inserted = [];
	state.updates = [];
	state.execCalls = [];
	state.remoteExecCalls = [];
	state.volumeServerId = null;
	state.linked.serverId = null;
	state.tarListing = "-rw-r--r-- root/root 12 2026-10-15 20:30:00 ./file\n";
	state.readerToken = "";
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
	state.streamImpl = async (command, options) => ({
		stdout: Readable.from(String(command).includes("tar tvzf") ? [state.tarListing] : [archive]),
		done: (async () => {
			const input = (options as { stdin?: Readable } | undefined)?.stdin;
			if (input)
				for await (const _chunk of input) {
				}
			return `${PIPELINE_EXIT_MARKER}0`;
		})(),
		abort: vi.fn(),
	});
	state.execImpl = async (command) => {
		if (command.startsWith("docker create --name 'nixploy-volume-backup-")) {
			state.readerToken = command.match(/nixploy.backup.volume-reader=([a-f0-9]{24})/)?.[1] ?? "";
			return "a".repeat(64);
		}
		if (command.startsWith("docker inspect --format '{{json .}}'"))
			return JSON.stringify({
				Id: "a".repeat(64),
				Name: `/nixploy-volume-backup-${state.readerToken}`,
				Config: { Labels: { "nixploy.backup.volume-reader": state.readerToken } },
			});
		if (command.startsWith("docker rm -f ") || command.startsWith("docker ps -a --no-trunc"))
			return "";
		if (command.startsWith("docker run --rm --network none --mount ")) return "";
		if (command === "docker service ls --quiet") return "";
		if (command.startsWith("docker volume inspect")) return "app_data\n";
		if (command.startsWith("docker ps -q --filter 'volume=")) return "";
		if (command.startsWith("docker ps -q")) return "abcdef012345\n";

		throw new Error(`unexpected command: ${command}`);
	};
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(state.configDir, { recursive: true, force: true });
});

describe("runVolumeBackup", () => {
	it.each(["interrupted restore marker", "staged restore tree", "previous restore tree"])(
		"refuses %s before opening an upload or pruning good archives",
		async (recoveryState) => {
			const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
			await store.put("volume-backup/app_data/good.gz", archive);
			const put = vi.spyOn(LocalBackupStore.prototype, "putStream");
			const prune = vi.spyOn(LocalBackupStore.prototype, "remove");
			const normal = state.execImpl;
			state.execImpl = async (command) => {
				if (command.includes('mkdir "$lock"')) throw new Error(recoveryState);
				return normal(command);
			};
			await expect(runVolumeBackup({ ...volumeBackup, keepLatestCount: 1 })).rejects.toThrow(
				recoveryState,
			);
			expect(put).not.toHaveBeenCalled();
			expect(prune).not.toHaveBeenCalled();
			expect(await store.get("volume-backup/app_data/good.gz")).toEqual(archive);
			expect(state.updates[0]).toMatchObject({ status: "error" });
		},
	);

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
		const reader = state.execCalls.find((command) => command.startsWith("docker create"));
		expect(reader).toContain("type=volume,source=app_data,target=/volume-data,readonly");
		expect(reader).toContain("nixploy.backup.volume-reader=");
		expect(reader).toContain("--exclude=");
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
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("volume-backup/app_data/good.gz", archive);
		const prune = vi.spyOn(LocalBackupStore.prototype, "remove");
		state.streamImpl = async () => ({
			stdout: Readable.from([archive]),
			done: Promise.resolve(`${PIPELINE_EXIT_MARKER}2`),
			abort: vi.fn(),
		});
		await expect(runVolumeBackup({ ...volumeBackup, keepLatestCount: 1 })).rejects.toThrow(
			/exited with status 2/,
		);
		expect(state.updates[0]).toMatchObject({ status: "error" });
		expect(prune).not.toHaveBeenCalled();
		expect(
			await readdir(path.join(state.configDir, "backups", "org-1", "volume-backup", "app_data")),
		).toEqual(["good.gz"]);
		expect(state.execCalls.some((command) => command.startsWith("docker rm -f "))).toBe(true);
		expect(state.execCalls.some((command) => command.includes('rmdir "$lock/active"'))).toBe(true);
	});

	it("does not prune good archives after an upload fails mid-stream", async () => {
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("volume-backup/app_data/good.gz", archive);
		vi.spyOn(LocalBackupStore.prototype, "putStream").mockImplementationOnce(
			async (_key, source) => {
				for await (const _chunk of source) throw new Error("upload failed after first chunk");
				throw new Error("missing stream bytes");
			},
		);
		const prune = vi.spyOn(LocalBackupStore.prototype, "remove");
		await expect(runVolumeBackup({ ...volumeBackup, keepLatestCount: 1 })).rejects.toThrow(
			/upload failed after first chunk/,
		);
		expect(prune).not.toHaveBeenCalled();
		expect(await store.get("volume-backup/app_data/good.gz")).toEqual(archive);
		const removed = state.execCalls.findIndex((command) => command.startsWith("docker rm -f "));
		const absent = state.execCalls.findIndex((command) =>
			command.startsWith("docker ps -a --no-trunc"),
		);
		const finished = state.execCalls.findIndex((command) =>
			command.includes('rmdir "$lock/active"'),
		);
		const release = state.execCalls.findIndex((command) => command.includes('rm "$lock/owner"'));
		expect(removed).toBeGreaterThanOrEqual(0);
		expect(absent).toBeGreaterThan(removed);
		expect(finished).toBeGreaterThan(absent);
		expect(release).toBeGreaterThan(finished);
	});

	it("checks the reader's actual exit status even if Docker attach exits zero", async () => {
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("volume-backup/app_data/good.gz", archive);
		const bin = path.join(state.configDir, "bin");
		await mkdir(bin);
		await writeFile(
			path.join(bin, "docker"),
			'#!/bin/sh\ncase "$1" in start) printf "nonempty producer bytes"; exit 0;; wait) echo 9; exit 0;; *) exit 2;; esac\n',
			{ mode: 0o700 },
		);
		state.streamImpl = async (command) => {
			const result = spawnSync("sh", ["-c", String(command)], {
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
			});
			expect(result.status).toBe(0);
			return {
				stdout: Readable.from([result.stdout]),
				done: Promise.resolve(result.stderr.toString()),
				abort: vi.fn(),
			};
		};
		const prune = vi.spyOn(LocalBackupStore.prototype, "remove");
		await expect(runVolumeBackup({ ...volumeBackup, keepLatestCount: 1 })).rejects.toThrow(
			/exited with status 1/,
		);
		expect(prune).not.toHaveBeenCalled();
		expect(await store.get("volume-backup/app_data/good.gz")).toEqual(archive);
	});

	it.each(["create transport lost", "foreign reader", "reader removal failed", "reader remains"])(
		"does not clear the active fence or prune when %s",
		async (failure) => {
			const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
			await store.put("volume-backup/app_data/good.gz", archive);
			const normal = state.execImpl;
			state.execImpl = async (command) => {
				if (failure === "create transport lost" && command.startsWith("docker create"))
					throw new Error("create transport lost");
				if (failure === "foreign reader" && command.startsWith("docker inspect --format"))
					return JSON.stringify({ Id: "a".repeat(64), Name: "/foreign", Config: { Labels: {} } });
				if (failure === "reader removal failed" && command.startsWith("docker rm -f"))
					throw new Error("reader removal failed");
				if (failure === "reader remains" && command.startsWith("docker ps -a --no-trunc"))
					return "a".repeat(64);
				return normal(command);
			};
			const prune = vi.spyOn(LocalBackupStore.prototype, "remove");
			await expect(runVolumeBackup({ ...volumeBackup, keepLatestCount: 1 })).rejects.toThrow();
			expect(prune).not.toHaveBeenCalled();
			expect(state.execCalls.some((command) => command.includes('rmdir "$lock/active"'))).toBe(
				false,
			);
			expect(await store.get("volume-backup/app_data/good.gz")).toEqual(archive);
			if (failure === "foreign reader")
				expect(state.execCalls.some((command) => command.startsWith("docker rm -f"))).toBe(false);
		},
	);

	it("does not start a run for a missing destination or a protected volume", async () => {
		state.destination = null;
		await expect(runVolumeBackup(volumeBackup)).rejects.toThrow("Destination not found: d1");
		await expect(
			runVolumeBackup({ ...volumeBackup, volumeName: "nixploy-postgres-data" }),
		).rejects.toThrow(/platform volume/);
		expect(state.inserted).toEqual([]);
	});
});

describe("archive restore safety", () => {
	it("validates CRC before creating any target writer", async () => {
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		const bad = Buffer.from(archive);
		bad[bad.length - 8] = (bad[bad.length - 8] ?? 0) ^ 255;
		await store.put("volume-backup/app_data/bad.gz", bad);
		await expect(restoreVolumeBackup(volumeBackup)).rejects.toThrow();
		expect(state.execCalls).toEqual([]);
	});

	it("refuses malformed tar before attaching the target volume", async () => {
		await runVolumeBackup(volumeBackup);
		state.execCalls = [];
		state.streamImpl = async () => ({
			stdout: Readable.from([]),
			done: Promise.resolve(""),
			abort: vi.fn(),
		});
		await expect(restoreVolumeBackup(volumeBackup)).rejects.toThrow(/no entries/);
		expect(state.execCalls.every((command) => !command.includes("-v "))).toBe(true);
	});

	it("refuses active volume writers before extraction", async () => {
		await runVolumeBackup(volumeBackup);
		state.execCalls = [];
		state.execImpl = async (command) =>
			command === "docker service ls --quiet"
				? ""
				: command.startsWith("docker ps")
					? "abcdef012345"
					: "app_data";
		const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(30_000);
		try {
			await expect(restoreVolumeBackup(volumeBackup)).rejects.toThrow(/Stop every container/);
		} finally {
			clock.mockRestore();
		}
		expect(state.execCalls.every((command) => !command.includes("-v "))).toBe(true);
	});

	it.each(["desired-running", "orphaned", "remove", "running"])(
		"refuses Swarm %s even with no local container",
		async (stateName) => {
			await runVolumeBackup(volumeBackup);
			state.execCalls = [];
			state.execImpl = async (command) => {
				if (command.startsWith("docker run --rm --network none --mount ")) return "";
				if (command.startsWith("docker volume inspect")) return "app_data";
				if (command === "docker service ls --quiet") return "abc123def456";
				if (command.startsWith("docker service inspect"))
					return JSON.stringify([
						{
							Spec: {
								Name: "consumer",
								Mode: { Replicated: { Replicas: stateName === "desired-running" ? 1 : 0 } },
								TaskTemplate: {
									ContainerSpec: { Mounts: [{ Type: "volume", Source: "app_data" }] },
								},
							},
						},
					]);
				if (command.startsWith("docker info")) return "target-node";
				if (command.startsWith("docker service ps")) return "task0123456789abcdefghijk";
				if (command.startsWith("docker inspect"))
					return JSON.stringify([{ NodeID: "unknown-node", Status: { State: stateName } }]);
				if (command.startsWith("docker ps")) return "";
				throw new Error("unexpected command");
			};
			await expect(restoreVolumeBackup(volumeBackup)).rejects.toThrow(
				stateName === "desired-running" ? /Stop every Swarm/ : /another node/,
			);
			expect(state.execCalls.every((command) => !command.includes("-v "))).toBe(true);
		},
	);

	it("refuses a running Redis before writing its data volume", async () => {
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("backup/database/a.gz", archive);
		state.tarListing = "-rw-r--r-- root/root 12 2026-10-15 20:30:00 ./data/dump.rdb\n";
		state.execImpl = async () =>
			JSON.stringify({
				Name: "database",
				Labels: { "nixploy.managed": "true", "nixploy.service.type": "redis" },
				Mode: { Replicated: { Replicas: 1 } },
				TaskTemplate: {
					ContainerSpec: { Mounts: [{ Type: "volume", Source: "database-data", Target: "/data" }] },
				},
			});
		await expect(
			restoreBackup({ ...backupRow, databaseType: "redis", redisId: "redis-1", postgresId: null }),
		).rejects.toThrow(/Stop the managed Redis/);
		expect(state.execCalls.every((command) => !command.includes("-v "))).toBe(true);
	});

	it("accepts many short tar entries across 64 KiB stdout boundaries", async () => {
		await runVolumeBackup(volumeBackup);
		const normal = state.streamImpl;
		state.streamImpl = async (command, options) => {
			if (!String(command).includes("tar tvzf")) return normal(command, options);
			const listing = Buffer.from(
				"-rw-r--r-- root/root 12 2026-10-15 20:30:00 ./file\n".repeat(4000),
			);
			return {
				stdout: Readable.from([
					listing.subarray(0, 65536),
					listing.subarray(65536, 131072),
					listing.subarray(131072),
				]),
				done: (async () => {
					for await (const _chunk of (options as { stdin: Readable }).stdin) {
					}
					return "";
				})(),
				abort: vi.fn(),
			};
		};
		await expect(restoreVolumeBackup(volumeBackup)).resolves.toHaveProperty("key");
	});

	it("replays only validated bytes through staged replacement", async () => {
		await runVolumeBackup(volumeBackup);
		state.execCalls = [];
		await restoreVolumeBackup(volumeBackup);
		const command = state.execCalls.find((value) => value.includes("-v "));
		expect(command).toContain(".nixploy-previous-");
		expect(command).toContain("move_children");
		expect(command).not.toContain("base64");
	});

	it.each([null, "remote-node"])(
		"holds the target-volume fence through consumer checks, replacement and cleanup on %s",
		async (serverId) => {
			state.volumeServerId = serverId;
			await runVolumeBackup(volumeBackup);
			state.execCalls = [];
			state.remoteExecCalls = [];
			await restoreVolumeBackup(volumeBackup);
			const index = (text: string) =>
				state.execCalls.findIndex((command) => command.includes(text));
			const acquire = index('mkdir "$lock"');
			const check = index("docker service ls --quiet");
			const activate = index('mkdir "$lock/active"');
			const replace = index("-v ");
			const release = index('rm "$lock/owner"');
			expect(acquire).toBeGreaterThanOrEqual(0);
			expect(check).toBeGreaterThan(acquire);
			expect(activate).toBeGreaterThan(check);
			expect(replace).toBeGreaterThan(activate);
			expect(release).toBeGreaterThan(replace);
			const fenceCalls = state.execCalls.filter((command) => command.includes("--mount "));
			expect(fenceCalls).toHaveLength(3);
			const token = fenceCalls[0]?.match(/[a-f0-9]{24}/)?.[0];
			expect(token).toHaveLength(24);
			expect(fenceCalls.every((command) => command.includes(token ?? "missing"))).toBe(true);
			if (serverId)
				expect(state.remoteExecCalls.filter((call) => fenceCalls.includes(call.command))).toEqual(
					fenceCalls.map((command) => ({ serverId, command })),
				);
		},
	);

	it("does not inspect consumers or start a replacement when another restore holds the fence", async () => {
		await runVolumeBackup(volumeBackup);
		state.execCalls = [];
		const normal = state.execImpl;
		state.execImpl = async (command) => {
			if (command.includes('mkdir "$lock"')) throw new Error("Volume restore is locked");
			return normal(command);
		};
		await expect(restoreVolumeBackup(volumeBackup)).rejects.toThrow(/Volume restore is locked/);
		expect(state.execCalls.some((command) => command.includes("docker service ls"))).toBe(false);
		expect(state.execCalls.some((command) => command.includes("-v "))).toBe(false);
		expect(state.execCalls.some((command) => command.includes('rm "$lock/owner"'))).toBe(false);
	});

	it("uses the same fence around the stopped Redis consumer check and replacement", async () => {
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("backup/database/a.gz", archive);
		state.tarListing = "-rw-r--r-- root/root 12 2026-10-15 20:30:00 ./data/dump.rdb\n";
		const normal = state.execImpl;
		state.execImpl = async (command) => {
			if (command.startsWith("docker service inspect"))
				return JSON.stringify({
					Name: "database",
					Labels: { "nixploy.managed": "true", "nixploy.service.type": "redis" },
					Mode: { Replicated: { Replicas: 0 } },
					TaskTemplate: {
						ContainerSpec: {
							Mounts: [{ Type: "volume", Source: "database-data", Target: "/data" }],
						},
					},
				});
			if (command.startsWith("docker info")) return "target-node";
			if (command.startsWith("docker service ps")) return "";
			if (command.startsWith("docker volume inspect") && command.includes("{{json .}}"))
				return JSON.stringify({ Name: "database-data", Labels: { "nixploy.managed": "true" } });
			return normal(command);
		};
		await restoreBackup({
			...backupRow,
			databaseType: "redis",
			redisId: "redis-1",
			postgresId: null,
		});
		const acquire = state.execCalls.findIndex((command) => command.includes('mkdir "$lock"'));
		const check = state.execCalls.findIndex((command) =>
			command.startsWith("docker service inspect"),
		);
		const replace = state.execCalls.findIndex((command) => command.includes("-v "));
		const release = state.execCalls.findIndex((command) => command.includes('rm "$lock/owner"'));
		expect(acquire).toBeGreaterThanOrEqual(0);
		expect(check).toBeGreaterThan(acquire);
		expect(replace).toBeGreaterThan(check);
		expect(release).toBeGreaterThan(replace);
	});

	it("validates a database archive before invoking psql", async () => {
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("backup/database/bad.gz", archive.subarray(0, -3));
		await expect(restoreBackup(backupRow)).rejects.toThrow();
		expect(state.execCalls.some((command) => command.includes("psql"))).toBe(false);
	});
});

describe("shared streaming publication", () => {
	it("publishes a complete instance pair with config before SQL, without base64", async () => {
		const original = process.env.DATABASE_URL;
		process.env.DATABASE_URL = "postgres://app:local-test@localhost/app";
		state.execImpl = async () => "/usr/bin/pg_dump";
		try {
			const result = await runBackup({
				...backupRow,
				databaseType: "web-server",
				appName: "web-server",
			});
			expect(result.bytes).toBe(archive.length * 2);
			expect(state.execCalls[1]).toContain("tar cf");
			expect(state.execCalls[2]).toContain("pg_dump");
			expect(state.execCalls.every((command) => !command.includes("base64"))).toBe(true);
		} finally {
			if (original === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = original;
		}
	});

	it("removes a failed instance pair and preserves previous good objects", async () => {
		const original = process.env.DATABASE_URL;
		process.env.DATABASE_URL = "postgres://app:local-test@localhost/app";
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("backup/web-server/old.gz", archive);
		await store.put("backup/web-server-config/old.gz", archive);
		state.execImpl = async () => "/usr/bin/pg_dump";
		state.streamImpl = async (command) => ({
			stdout: Readable.from([archive]),
			done: Promise.resolve(
				`${PIPELINE_EXIT_MARKER}${String(command).includes("pg_dump") ? 1 : 0}`,
			),
			abort: vi.fn(),
		});
		try {
			await expect(
				runBackup({
					...backupRow,
					databaseType: "web-server",
					appName: "web-server",
					keepLatestCount: 1,
				}),
			).rejects.toThrow(/status 1/);
			expect(await store.list("backup/")).toEqual(
				expect.arrayContaining(["backup/web-server/old.gz", "backup/web-server-config/old.gz"]),
			);
			expect(await store.list("backup/")).toHaveLength(2);
		} finally {
			if (original === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = original;
		}
	});
});

describe("Redis live snapshot cleanup", () => {
	const redisBackup: BackupRow = {
		...backupRow,
		databaseType: "redis",
		redisId: "redis-1",
		postgresId: null,
	};
	const prep = async (command: string) => {
		if (command.startsWith("docker ps")) return "abcdef012345";
		if (command.includes("CONFIG GET auto-aof-rewrite-percentage")) return "100\n/data\n";
		return "OK";
	};
	it("resets automatic rewrites after a producer/upload failure", async () => {
		state.execImpl = prep;
		state.streamImpl = async () => ({
			stdout: Readable.from([archive]),
			done: Promise.resolve(`${PIPELINE_EXIT_MARKER}1`),
			abort: vi.fn(),
		});
		await expect(runBackup(redisBackup)).rejects.toThrow(/status 1/);
		expect(state.execCalls.at(-1)).toContain("CONFIG SET auto-aof-rewrite-percentage");
		expect(state.execCalls.at(-1)).toContain("100");
		expect(state.updates.at(-1)).toMatchObject({ status: "error" });
	});
	it("does not prune a good backup or claim success when restoring the setting fails", async () => {
		const store = new LocalBackupStore(path.join(state.configDir, "backups", "org-1"));
		await store.put("backup/database/old.gz", archive);
		state.execImpl = async (command) => {
			if (command.includes("CONFIG SET") && !command.includes("CONFIG GET"))
				throw new Error("restore automatic rewrites failed");
			return prep(command);
		};
		await expect(runBackup({ ...redisBackup, keepLatestCount: 1 })).rejects.toThrow(
			/restore automatic rewrites failed/,
		);
		expect((await store.list("backup/database/")).includes("backup/database/old.gz")).toBe(true);
		expect(state.updates.at(-1)).toMatchObject({ status: "error" });
	});
});

describe("dump readiness retry", () => {
	it("classifies a database that is still starting as retryable", () => {
		expect(
			isDatabaseStartingError(
				new Error(
					"Dump of db: the dump command exited with status 1 — pg_dump: error: connection to server on socket failed: the database system is starting up",
				),
			),
		).toBe(true);
		expect(
			isDatabaseStartingError(
				new Error("mysqldump: Got error: 2002: Can't connect to local server"),
			),
		).toBe(true);
		expect(
			isDatabaseStartingError(
				new Error(
					'Dump of db: the dump command exited with status 1 — pg_dump: error: database "x" does not exist',
				),
			),
		).toBe(false);
	});

	it("reads the retry window from the environment", () => {
		const previous = process.env.NIXPLOY_BACKUP_READY_TIMEOUT_MS;
		process.env.NIXPLOY_BACKUP_READY_TIMEOUT_MS = "0";
		expect(databaseReadyTimeoutMs()).toBe(0);
		process.env.NIXPLOY_BACKUP_READY_TIMEOUT_MS = "abc";
		expect(databaseReadyTimeoutMs()).toBe(DEFAULT_DATABASE_READY_TIMEOUT_MS);
		if (previous === undefined) delete process.env.NIXPLOY_BACKUP_READY_TIMEOUT_MS;
		else process.env.NIXPLOY_BACKUP_READY_TIMEOUT_MS = previous;
	});
});
