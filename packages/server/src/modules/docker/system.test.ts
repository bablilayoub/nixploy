import { describe, expect, it, vi } from "vitest";
import { readDockerSystemInfo } from "./system";

const containerId = "d".repeat(64);
const version = { Server: { Version: "29.9.2", Os: "linux", Arch: "amd64" } };
const diskRow = {
	Type: "Containers",
	TotalCount: "5",
	Active: "3",
	Size: "20MB",
	Reclaimable: "10MB (50%)",
};

function runner(diskUsage: string | Error) {
	return vi.fn(async (command: string) => {
		if (command.startsWith("docker version")) return JSON.stringify(version);
		if (command.startsWith("docker system df")) {
			if (diskUsage instanceof Error) throw diskUsage;
			return diskUsage;
		}
		throw new Error(`Unexpected command: ${command}`);
	});
}

describe("readDockerSystemInfo", () => {
	it("keeps the existing engine and disk-usage response on a healthy daemon", async () => {
		const info = await readDockerSystemInfo(runner(`\n${JSON.stringify(diskRow)}\n\n`));
		expect(info).toEqual({ version, df: [diskRow], diskUsageError: null });
	});

	it("reports missing snapshot usage separately while retaining engine details", async () => {
		const error = new Error(
			`Command failed: docker system df\nError response from daemon: failed to retrieve container list: rw layer snapshot not found for container ${containerId}\n`,
		);
		expect(await readDockerSystemInfo(runner(error))).toEqual({
			version,
			df: [],
			diskUsageError: { code: "MISSING_CONTAINER_SNAPSHOT", containerId },
		});
	});

	it("recognizes a remote snapshot error without returning SSH stderr", async () => {
		const error = Object.assign(new Error('"docker" failed (exit 1)'), {
			stderr: `private-host password=PRIVATE\nrw layer snapshot not found for container ${containerId}`,
		});
		const info = await readDockerSystemInfo(runner(error));
		expect(info.diskUsageError?.containerId).toBe(containerId);
		expect(JSON.stringify(info)).not.toMatch(/private-host|password|PRIVATE/);
	});

	it("does not hide unrelated disk-usage failures", async () => {
		const error = new Error("permission denied connecting to Docker socket");
		await expect(readDockerSystemInfo(runner(error))).rejects.toBe(error);
	});

	it("does not hide daemon/version failures behind a partial response", async () => {
		const error = new Error("Cannot connect to the Docker daemon");
		await expect(
			readDockerSystemInfo(async (command) => {
				if (command.startsWith("docker version")) throw error;
				throw new Error(`rw layer snapshot not found for container ${containerId}`);
			}),
		).rejects.toBe(error);
	});

	it("retries usage normally after the snapshot problem is repaired", async () => {
		const run = runner(new Error(`rw layer snapshot not found for container ${containerId}`));
		expect((await readDockerSystemInfo(run)).diskUsageError).not.toBeNull();
		run.mockImplementation(runner(JSON.stringify(diskRow)));
		expect(await readDockerSystemInfo(run)).toEqual({
			version,
			df: [diskRow],
			diskUsageError: null,
		});
	});

	it("does not reinterpret malformed JSON as empty or healthy data", async () => {
		await expect(readDockerSystemInfo(runner("invalid JSON"))).rejects.toBeInstanceOf(SyntaxError);
	});
});
