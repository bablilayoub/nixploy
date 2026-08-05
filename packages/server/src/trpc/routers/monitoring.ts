import { TRPCError } from "@trpc/server";
import Docker from "dockerode";
import { eq } from "drizzle-orm";
import { createOSUtils, type MonitorResult } from "node-os-utils";
import { z } from "zod";
import { db } from "../../db";
import { applications, compose, mariadb, mongo, mysql, postgres, redis } from "../../db/schema";
import { findServerById, getServerStats, type ServerStats } from "../../modules/cluster";
import { readMetricsHistory } from "../../modules/monitoring/history";
import { assertOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import { execAsyncRemote } from "../../utils/exec";
import { mapDockerStats } from "../../ws/docker-stats";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

/**
 * Host/container metrics. Remote managed servers are queried over SSH (via
 * the cluster module); the Nixploy host itself is measured locally with
 * node-os-utils + dockerode. `dockerCleanup` is a manual trigger for the
 * deploy engine's cleanup routine.
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

const osu = createOSUtils();
const docker = new Docker();

/** Unwrap node-os-utils' success/error result union. */
function unwrap<T>(result: MonitorResult<T>, what: string): T {
	if (!result.success) {
		throw new Error(`Failed to read ${what}: ${result.error.message}`);
	}
	return result.data;
}

/** Live metrics of the Nixploy host itself. */
async function getLocalServerStats(): Promise<ServerStats> {
	const [info, , memInfo, diskInfo, loadAverage] = await Promise.all([
		docker.info(),
		osu.cpu.usage(),
		osu.memory.info(),
		osu.disk.info(),
		osu.cpu.loadAverage(),
	]);
	const mem = unwrap(memInfo, "memory metrics");
	const disks = unwrap(diskInfo, "disk metrics");
	const load = unwrap(loadAverage, "load average");
	const rootDisk = disks.find((d) => d.mountpoint === "/") ?? disks[0];
	return {
		dockerVersion: info.ServerVersion ?? "",
		operatingSystem: info.OperatingSystem ?? "",
		architecture: info.Architecture ?? "",
		cpus: info.NCPU ?? 0,
		memTotalBytes: mem.total.bytes,
		containers: info.Containers ?? 0,
		containersRunning: info.ContainersRunning ?? 0,
		containersStopped: info.ContainersStopped ?? 0,
		images: info.Images ?? 0,
		swarmNodeState: info.Swarm?.LocalNodeState ?? "",
		memory: {
			totalBytes: mem.total.bytes,
			usedBytes: mem.used.bytes,
			availableBytes: mem.available.bytes,
		},
		disk: {
			totalBytes: rootDisk?.total.bytes ?? 0,
			usedBytes: rootDisk?.used.bytes ?? 0,
			availableBytes: rootDisk?.available.bytes ?? 0,
			usedPercent: rootDisk ? `${rootDisk.usagePercentage}%` : "",
		},
		loadAverage: [load.load1, load.load5, load.load15],
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

function sumBlockIo(entries: Array<{ op?: string; value?: number }> | undefined, op: string) {
	return (entries ?? [])
		.filter((entry) => entry.op === op)
		.reduce((total, entry) => total + (entry.value ?? 0), 0);
}

/** Normalize dockerode's one-shot container stats payload. */
function normalizeContainerStats(stats: Docker.ContainerStats): ContainerStats {
	const cpuDelta =
		(stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
		(stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
	const systemDelta =
		(stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
	const onlineCpus =
		stats.cpu_stats?.online_cpus ?? stats.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
	const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

	const networks = Object.values(stats.networks ?? {}) as Array<{
		rx_bytes?: number;
		tx_bytes?: number;
	}>;

	return {
		cpuPercent: Math.max(0, cpuPercent),
		memoryUsageBytes: stats.memory_stats?.usage ?? 0,
		memoryLimitBytes: stats.memory_stats?.limit ?? 0,
		memoryPercent: stats.memory_stats?.limit
			? ((stats.memory_stats?.usage ?? 0) / stats.memory_stats.limit) * 100
			: 0,
		networkRxBytes: networks.reduce((total, n) => total + (n.rx_bytes ?? 0), 0),
		networkTxBytes: networks.reduce((total, n) => total + (n.tx_bytes ?? 0), 0),
		blockReadBytes: sumBlockIo(stats.blkio_stats?.io_service_bytes_recursive, "read"),
		blockWriteBytes: sumBlockIo(stats.blkio_stats?.io_service_bytes_recursive, "write"),
		pids: stats.pids_stats?.current ?? 0,
	};
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
			if (input.serverId) {
				const organizationId = await getOrganizationId(ctx.session);
				await findServerOrThrow(input.serverId, organizationId);
				return await getRemoteContainerStats(input.serverId, input.containerId);
			}
			const stats = await docker.getContainer(input.containerId).stats({ stream: false });
			return normalizeContainerStats(stats as Docker.ContainerStats);
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
