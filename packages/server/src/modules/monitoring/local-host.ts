import { readFile } from "node:fs/promises";
import { freemem, loadavg, totalmem } from "node:os";
import Docker from "dockerode";
import { execAsync } from "../../utils/exec";
import type { ServerStats } from "../cluster";

/**
 * Live metrics of the **Nixploy host itself** — the machine the panel runs on,
 * as opposed to a managed server (`modules/cluster`) or a tenant container
 * (`./sampler.ts`). Moved out of `trpc/routers/monitoring.ts` (audit F5: no
 * logic in routers).
 *
 * Not to be confused with `./host.ts`, which reports disk usage of one
 * filesystem for the platform-alert cron; this module answers the whole
 * `ServerStats` shape the Host monitoring card renders.
 *
 * Measured with dockerode + `/proc` + `df` rather than node-os-utils, which
 * breaks inside the Alpine container.
 */

const docker = new Docker();

/** Host memory from /proc/meminfo (works in Alpine containers; reflects the host). */
async function readMemoryStats(): Promise<ServerStats["memory"]> {
	try {
		const text = await readFile("/proc/meminfo", "utf8");
		const kb = (key: string): number => {
			const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
			return match ? Number(match[1]) * 1024 : 0;
		};
		const totalBytes = kb("MemTotal");
		const availableBytes = kb("MemAvailable") || kb("MemFree");
		if (totalBytes > 0) {
			return {
				totalBytes,
				usedBytes: Math.max(0, totalBytes - availableBytes),
				availableBytes,
			};
		}
	} catch {
		// Non-Linux /proc — fall through to Node os.
	}
	const totalBytes = totalmem();
	const availableBytes = freemem();
	return {
		totalBytes,
		usedBytes: Math.max(0, totalBytes - availableBytes),
		availableBytes,
	};
}

/**
 * Disk usage for `/` via `df`. Soft-fails to zeros so a missing `df` never
 * blanks the whole Host monitoring card (the old node-os-utils path threw
 * "Command execution failed: getDiskInfo" inside Alpine).
 *
 * Uses POSIX `df -Pk` (1024-byte blocks) — portable across GNU coreutils and
 * BusyBox (Alpine), unlike `df -B1`.
 */
async function readRootDiskStats(): Promise<ServerStats["disk"]> {
	try {
		const stdout = await execAsync("df -Pk / 2>/dev/null | tail -n 1", { timeout: 5_000 });
		const parts = stdout.trim().split(/\s+/);
		// Filesystem 1024-blocks Used Available Use% Mounted
		if (parts.length >= 5) {
			const totalKb = Number(parts[1] ?? 0);
			const usedKb = Number(parts[2] ?? 0);
			const availableKb = Number(parts[3] ?? 0);
			if (Number.isFinite(totalKb) && totalKb > 0) {
				return {
					totalBytes: totalKb * 1024,
					usedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : 0,
					availableBytes: Number.isFinite(availableKb) ? availableKb * 1024 : 0,
					usedPercent: parts[4] ?? "",
				};
			}
		}
	} catch {
		// ignore
	}
	return { totalBytes: 0, usedBytes: 0, availableBytes: 0, usedPercent: "" };
}

/** Live metrics of the Nixploy host itself. */
export async function getLocalServerStats(): Promise<ServerStats> {
	const [info, memory, disk] = await Promise.all([
		docker.info(),
		readMemoryStats(),
		readRootDiskStats(),
	]);
	const load = loadavg();

	return {
		dockerVersion: info.ServerVersion ?? "",
		operatingSystem: info.OperatingSystem ?? "",
		architecture: info.Architecture ?? "",
		cpus: info.NCPU ?? 0,
		memTotalBytes: memory.totalBytes,
		containers: info.Containers ?? 0,
		containersRunning: info.ContainersRunning ?? 0,
		containersStopped: info.ContainersStopped ?? 0,
		images: info.Images ?? 0,
		swarmNodeState: info.Swarm?.LocalNodeState ?? "",
		memory,
		disk,
		loadAverage: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
	};
}
