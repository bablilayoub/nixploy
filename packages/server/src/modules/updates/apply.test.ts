import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Update admission stays offline; all database and Docker transports are mocked.
vi.mock("../../db", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../utils/exec", () => ({ execAsync: vi.fn() }));
vi.mock("../observability/health", () => ({ countActiveDeployments: vi.fn(async () => 0) }));
vi.mock("../monitoring/host", () => ({ readDiskStats: vi.fn(async () => null) }));
vi.mock("./check", () => ({
	getAppVersion: () => "1.2.0",
	NIXPLOY_SERVICE_NAME: "nixploy",
}));
vi.mock("./settings", () => ({
	getUpdateSettings: vi.fn(),
	patchUpdateSettings: vi.fn(),
}));

import { db } from "../../db";
import { execAsync } from "../../utils/exec";
import { applyUpdate, imageTag, PRE_UPDATE_BACKUP_KEEP, prunePreUpdateDumps } from "./apply";
import { getUpdateSettings, patchUpdateSettings } from "./settings";

describe("GUI update admission", () => {
	const image = "ghcr.io/bablilayoub/nixploy:v1.3.0";
	const serviceList = "docker service ls --format '{{.Name}}'";
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.mocked(getUpdateSettings).mockResolvedValue({
			image: "ghcr.io/bablilayoub/nixploy:latest",
			updateInProgress: false,
			pinnedVersion: null,
			releaseTag: null,
		} as Awaited<ReturnType<typeof getUpdateSettings>>);
		vi.mocked(execAsync).mockImplementation(async (command) => {
			if (command === serviceList) return "nixploy\nnixploy-postgres\n";
			return command.startsWith("docker run") ? "encrypted-org-env-v1" : "";
		});
		vi.mocked(db.execute).mockResolvedValue([{ upgraded: true }] as never);
	});
	afterEach(async () => {
		await vi.runOnlyPendingTimersAsync();
		vi.useRealTimers();
	});
	const expectNoRoll = () => {
		expect(
			vi.mocked(execAsync).mock.calls.some(([command]) => command.startsWith("docker pull")),
		).toBe(false);
		expect(
			vi.mocked(execAsync).mock.calls.some(([command]) => command.startsWith("docker ps")),
		).toBe(false);
		expect(patchUpdateSettings).not.toHaveBeenCalled();
	};
	it("fails before pulling when service discovery cannot prove the platform topology", async () => {
		vi.mocked(execAsync).mockRejectedValue(new Error("Docker manager unavailable"));
		await expect(applyUpdate({ image, force: true })).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: expect.stringContaining("updated host update.sh"),
		});
		expectNoRoll();
	});
	it("rejects an empty service list rather than treating it as standalone", async () => {
		vi.mocked(execAsync).mockResolvedValue("");
		await expect(applyUpdate({ image })).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expectNoRoll();
	});
	it("requires the host updater for a split install even when forced", async () => {
		vi.mocked(execAsync).mockResolvedValue("nixploy\nnixploy-worker\nnixploy-postgres\n");
		await expect(applyUpdate({ image, force: true })).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: expect.stringContaining("drained and upgraded together"),
		});
		expectNoRoll();
	});
	it("rechecks topology after the pull before backup or update flags", async () => {
		let discoveries = 0;
		vi.mocked(execAsync).mockImplementation(async (command) => {
			if (command !== serviceList) return "";
			return ++discoveries === 1 ? "nixploy\n" : "nixploy\nnixploy-worker\n";
		});
		await expect(applyUpdate({ image })).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(execAsync).toHaveBeenCalledWith(`docker pull '${image}'`, expect.any(Object));
		expect(
			vi.mocked(execAsync).mock.calls.some(([command]) => command.startsWith("docker ps")),
		).toBe(false);
		expect(patchUpdateSettings).not.toHaveBeenCalled();
	});
	it.each([
		{ image: "ghcr.io/bablilayoub/nixploy:v1.1.0", allowDowngrade: true, force: true },
		{ version: "1.1.0", allowDowngrade: true, force: true },
	])("cannot force an image-only downgrade after the storage transition: %j", async (options) => {
		await expect(applyUpdate(options)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: expect.stringContaining("Restore the matching pre-upgrade database"),
		});
		expect(db.execute).toHaveBeenCalledOnce();
		expectNoRoll();
	});
	it("refuses a downgrade when the storage protocol cannot be inspected", async () => {
		vi.mocked(db.execute).mockRejectedValue(new Error("Database unavailable"));
		await expect(
			applyUpdate({ image: "ghcr.io/bablilayoub/nixploy:v1.1.0", allowDowngrade: true }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expectNoRoll();
	});
	it("rolls a confirmed standalone installation with pause on failure", async () => {
		const result = await applyUpdate({ image });
		expect(result).toMatchObject({
			started: true,
			isDowngrade: false,
			message: expect.stringContaining("failed updates pause for manual recovery"),
		});
		await vi.runOnlyPendingTimersAsync();
		const roll = vi
			.mocked(execAsync)
			.mock.calls.find(([command]) => command.startsWith("docker service update"))?.[0];
		expect(roll).toContain("--update-failure-action pause");
		expect(roll).not.toContain("--update-failure-action rollback");
		expect(execAsync).toHaveBeenCalledWith(serviceList, expect.any(Object));
	});

	it.each(["ghcr.io/bablilayoub/nixploy:latest", "ghcr.io/bablilayoub/nixploy:v1.2.0"])(
		"rejects an incompatible image despite an equal or mutable tag: %s",
		async (target) => {
			vi.mocked(execAsync).mockImplementation(async (command) =>
				command === serviceList ? "nixploy\n" : "",
			);
			await expect(applyUpdate({ image: target, force: true })).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
				message: expect.stringContaining("target image cannot be verified"),
			});
			expect(
				vi
					.mocked(execAsync)
					.mock.calls.some(([command]) => command.startsWith("docker service update")),
			).toBe(false);
			expect(patchUpdateSettings).not.toHaveBeenCalled();
		},
	);
});

describe("imageTag", () => {
	it("extracts the tag and ignores digests and registry ports", () => {
		expect(imageTag("ghcr.io/bablilayoub/nixploy:v0.2.0@sha256:abc")).toBe("v0.2.0");
		expect(imageTag("ghcr.io/bablilayoub/nixploy:latest")).toBe("latest");
		expect(imageTag("localhost:5000/nixploy")).toBe("");
		expect(imageTag("nixploy@sha256:abc")).toBe("");
	});
});

describe("prunePreUpdateDumps", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "nixploy-dumps-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("keeps the newest dumps and leaves other files alone", async () => {
		const names = ["a", "b", "c", "d", "e"].map((n) => `pre-update-v0.1.${n}-t.sql.gz`);
		for (const [index, name] of names.entries()) {
			const file = join(dir, name);
			await writeFile(file, "x");
			const when = new Date(2026, 0, 1 + index);
			await utimes(file, when, when);
		}
		await writeFile(join(dir, "manual.sql.gz"), "keep me");
		await writeFile(join(dir, "pre-update-notes.txt"), "keep me");

		const removed = await prunePreUpdateDumps(dir);
		expect(removed.map((f) => f.split("/").pop())).toEqual([names[1], names[0]]);
		const left = (await readdir(dir)).sort();
		expect(left).toEqual(
			[...names.slice(5 - PRE_UPDATE_BACKUP_KEEP), "manual.sql.gz", "pre-update-notes.txt"].sort(),
		);
	});

	it("is a no-op for a missing directory", async () => {
		await expect(prunePreUpdateDumps(join(dir, "missing"))).resolves.toEqual([]);
	});
});
