import { readFile } from "node:fs/promises";
import { freemem, loadavg, totalmem } from "node:os";
import { TRPCError } from "@trpc/server";
import Docker from "dockerode";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { applications, compose, mariadb, mongo, mysql, postgres, redis } from "../../db/schema";
import { findServerById, getServerStats, type ServerStats } from "../../modules/cluster";
import { readMetricsHistory } from "../../modules/monitoring/history";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { mapDockerStats } from "../../ws/docker-stats";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

/**
 * Host/container metrics. Remote managed servers are queried over SSH (via
 * the cluster module); the Nixploy host itself is measured locally with
 * dockerode + /proc + `df` (node-os-utils breaks in Alpine containers).
 * `dockerCleanup` is a manual trigger for the deploy engine's cleanup routine.
 */

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

async function findServerOrThrow(serverId: string, organizationId: string) {
	const server = await findServerById(serverId, organizationId);
	if (!server) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
	}
	return server;
}

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
async function readDiskStats(): Promise<ServerStats["disk"]> {
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
async function getLocalServerStats(): Promise<ServerStats> {
	const [info, memory, disk] = await Promise.all([
		docker.info(),
		readMemoryStats(),
		readDiskStats(),
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

export interface ContainerStats {
	cpuPercent: number;
	memoryUsageBytes: number;
	memoryLimitBytes: number;
	memoryPercent: number;
	networkRxBytes: number;
	networkTxBytes: number;
	blockReadBytes: number;
	blockWriteBytes: number;
	pids: number;
}

/** One-shot container stats on a remote server (`docker stats --no-stream`). */
async function getRemoteContainerStats(
	serverId: string,
	containerId: string,
): Promise<ContainerStats> {
	const raw = await execAsyncRemote(
		serverId,
		`docker stats --no-stream --format '{{json .Stats}}' '${containerId.replace(/'/g, `'\\''`)}'`,
	);
	// The CLI's pre-computed format differs from the Engine API; parse what it
	// exposes (CPUPerc/MemPerc are strings like "1.23%").
	const line = raw.trim().split("\n")[0] ?? "";
	if (!line) {
		throw new Error(`No stats returned for container ${containerId}`);
	}
	const parsed = JSON.parse(line) as Record<string, string>;
	return {
		cpuPercent: Number.parseFloat(parsed.CPUPerc ?? "0") || 0,
		memoryUsageBytes: 0,
		memoryLimitBytes: 0,
		memoryPercent: Number.parseFloat(parsed.MemPerc ?? "0") || 0,
		networkRxBytes: 0,
		networkTxBytes: 0,
		blockReadBytes: 0,
		blockWriteBytes: 0,
		pids: Number.parseInt(parsed.PIDs ?? "0", 10) || 0,
	};
}

export const monitoringRouter = router({
	/**
	 * Host metrics: the Nixploy server itself when `serverId` is omitted,
	 * otherwise the given managed server (collected over SSH).
	 */
	serverStats: protectedProcedure
		.input(z.object({ serverId: z.string().min(1).optional() }).optional())
		.query(async ({ ctx, input }) => {
			if (!input?.serverId) {
				return await getLocalServerStats();
			}
			const organizationId = await getOrganizationId(ctx.session);
			await findServerOrThrow(input.serverId, organizationId);
			return await getServerStats(input.serverId);
		}),

	/** One-shot container stats (locally via dockerode, remotely via SSH). */
	containerStats: protectedProcedure
		.input(z.object({ containerId: z.string().min(1), serverId: z.string().nullish() }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			if (input.serverId) {
				await findServerOrThrow(input.serverId, organizationId);
				return await getRemoteContainerStats(input.serverId, input.containerId);
			}
			// Local-by-id without org mapping is an IDOR risk — require an owned serverId.
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "serverId is required for container stats",
			});
		}),

	/** Manually trigger the deploy engine's docker cleanup (prune) routine. */
	dockerCleanup: protectedProcedure
		.input(z.object({ serverId: z.string().nullish() }).optional())
		.mutation(async ({ ctx, input }) => {
			const serverId = input?.serverId ?? null;
			// Prune is destructive and host-wide, like the Docker control center.
			const organizationId = await getOrganizationId(ctx.session);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");
			if (serverId) {
				await findServerOrThrow(serverId, organizationId);
			}
			const { dockerCleanup } = await import("../../modules/deployment/cleanup");
			await dockerCleanup(serverId);
			return { success: true };
		}),

	/**
	 * Per-replica stats: one-shot stats for every task container of a
	 * service (local host only; empty for remote or single containers).
	 */
	replicaStats: protectedProcedure
		.input(z.object({ appName: z.string().min(1), serverId: z.string().nullish() }))
		.query(async ({ ctx, input }) => {
			if (input.serverId) return []; // remote replica fan-out: live-only for now
			const organizationId = await getOrganizationId(ctx.session);
			const withTenancy = {
				with: { environment: { with: { project: true } } },
			} as const;
			const candidates = await Promise.all([
				db.query.applications.findFirst({
					where: eq(applications.appName, input.appName),
					...withTenancy,
				}),
				db.query.compose.findFirst({
					where: eq(compose.appName, input.appName),
					...withTenancy,
				}),
				db.query.postgres.findFirst({
					where: eq(postgres.appName, input.appName),
					...withTenancy,
				}),
				db.query.mysql.findFirst({
					where: eq(mysql.appName, input.appName),
					...withTenancy,
				}),
				db.query.mariadb.findFirst({
					where: eq(mariadb.appName, input.appName),
					...withTenancy,
				}),
				db.query.mongo.findFirst({
					where: eq(mongo.appName, input.appName),
					...withTenancy,
				}),
				db.query.redis.findFirst({
					where: eq(redis.appName, input.appName),
					...withTenancy,
				}),
			]);
			const owner = candidates.find(
				(row) => row && row.environment.project.organizationId === organizationId,
			);
			if (!owner) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
			}

			let containers = await docker.listContainers({
				filters: { label: [`com.docker.swarm.service.name=${input.appName}`] },
			});
			if (containers.length === 0) {
				containers = await docker.listContainers({ filters: { name: [input.appName] } });
			}
			const stats = await Promise.all(
				containers.map(async (container) => {
					try {
						const raw = await docker.getContainer(container.Id).stats({ stream: false });
						const frame = mapDockerStats(raw as Docker.ContainerStats);
						return {
							id: container.Id.slice(0, 12),
							name: container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12),
							state: container.State,
							cpu: frame.cpu,
							memoryUsed: frame.memory.used,
							memoryPercent: frame.memory.percent,
							pids: frame.pids,
						};
					} catch {
						return null; // container racing a restart
					}
				}),
			);
			return stats.filter((row): row is NonNullable<typeof row> => row !== null);
		}),

	/**
	 * Historical metrics of a service (applications + databases, local host
	 * only), sampled every 30s and kept for 48h by the metrics-history cron.
	 */
	history: protectedProcedure
		.input(z.object({ appName: z.string().min(1), hours: z.number().min(0.5).max(48) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const withTenancy = {
				with: { environment: { with: { project: true } } },
			} as const;
			const candidates = await Promise.all([
				db.query.applications.findFirst({
					where: eq(applications.appName, input.appName),
					...withTenancy,
				}),
				db.query.compose.findFirst({
					where: eq(compose.appName, input.appName),
					...withTenancy,
				}),
				db.query.postgres.findFirst({
					where: eq(postgres.appName, input.appName),
					...withTenancy,
				}),
				db.query.mysql.findFirst({
					where: eq(mysql.appName, input.appName),
					...withTenancy,
				}),
				db.query.mariadb.findFirst({
					where: eq(mariadb.appName, input.appName),
					...withTenancy,
				}),
				db.query.mongo.findFirst({
					where: eq(mongo.appName, input.appName),
					...withTenancy,
				}),
				db.query.redis.findFirst({
					where: eq(redis.appName, input.appName),
					...withTenancy,
				}),
			]);
			const owner = candidates.find(
				(row) => row && row.environment.project.organizationId === organizationId,
			);
			if (!owner) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
			}
			return await readMetricsHistory(input.appName, input.hours);
		}),
});
