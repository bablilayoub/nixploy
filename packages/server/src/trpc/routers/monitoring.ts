import { readFile } from "node:fs/promises";
import { freemem, loadavg, totalmem } from "node:os";
import { TRPCError } from "@trpc/server";
import Docker from "dockerode";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
	applications,
	compose,
	environments,
	mariadb,
	mongo,
	mysql,
	postgres,
	projects,
	redis,
} from "../../db/schema";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { findServerById, getServerStatsCached, type ServerStats } from "../../modules/cluster";
import { shellQuote } from "../../modules/compose/paths";
import { readLatestMetricsSample, readMetricsHistory } from "../../modules/monitoring/history";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { mapDockerStats } from "../../ws/docker-stats";
import { isValidContainerId } from "../../ws/utils";
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
	if (!isValidContainerId(containerId)) {
		throw new Error("Invalid container id");
	}
	const raw = await execAsyncRemote(
		serverId,
		`docker stats --no-stream --format '{{json .Stats}}' ${shellQuote(containerId)}`,
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
				// Local host metrics are instance-wide recon — not org-scoped.
				await assertInstanceAdmin(ctx.session);
				return await getLocalServerStats();
			}
			const organizationId = await getOrganizationId(ctx.session);
			await findServerOrThrow(input.serverId, organizationId);
			return await getServerStatsCached(input.serverId);
		}),

	/** One-shot container stats (locally via dockerode, remotely via SSH). */
	containerStats: protectedProcedure
		.input(
			z.object({
				containerId: z.string().min(1).refine(isValidContainerId, "Invalid container id"),
				serverId: z.string().nullish(),
			}),
		)
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
			await assertCapability(ctx.session.user.id, organizationId, "settings.manage");
			if (serverId) {
				await findServerOrThrow(serverId, organizationId);
			} else {
				// Local docker.sock — instance admin only (parity with dockerRouter).
				await assertInstanceAdmin(ctx.session);
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
				containers = await docker.listContainers({
					filters: { label: [`com.docker.compose.project=${input.appName}`] },
				});
			}
			if (containers.length === 0) {
				containers = await docker.listContainers({
					filters: { label: [`com.docker.stack.namespace=${input.appName}`] },
				});
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

	/**
	 * Org-wide fleet: every service with status + latest local metrics sample
	 * (remote-hosted services omit metrics; charts stay live-only for them).
	 */
	fleetOverview: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const orgProjects = await db.query.projects.findMany({
			where: eq(projects.organizationId, organizationId),
			columns: { projectId: true, name: true },
		});
		if (orgProjects.length === 0) return [];
		const projectNameById = new Map(orgProjects.map((row) => [row.projectId, row.name]));
		const environmentRows = await db.query.environments.findMany({
			where: inArray(
				environments.projectId,
				orgProjects.map((row) => row.projectId),
			),
			columns: { environmentId: true, name: true, projectId: true },
		});
		if (environmentRows.length === 0) return [];
		const envIds = environmentRows.map((row) => row.environmentId);
		const envById = new Map(environmentRows.map((row) => [row.environmentId, row]));

		const [appRows, composeRows, postgresRows, mysqlRows, mariadbRows, mongoRows, redisRows] =
			await Promise.all([
				db.query.applications.findMany({
					where: inArray(applications.environmentId, envIds),
					columns: {
						applicationId: true,
						name: true,
						appName: true,
						status: true,
						serverId: true,
						environmentId: true,
					},
				}),
				db.query.compose.findMany({
					where: inArray(compose.environmentId, envIds),
					columns: {
						composeId: true,
						name: true,
						appName: true,
						status: true,
						serverId: true,
						environmentId: true,
					},
				}),
				db.query.postgres.findMany({
					where: inArray(postgres.environmentId, envIds),
					columns: {
						postgresId: true,
						name: true,
						appName: true,
						status: true,
						serverId: true,
						environmentId: true,
					},
				}),
				db.query.mysql.findMany({
					where: inArray(mysql.environmentId, envIds),
					columns: {
						mysqlId: true,
						name: true,
						appName: true,
						status: true,
						serverId: true,
						environmentId: true,
					},
				}),
				db.query.mariadb.findMany({
					where: inArray(mariadb.environmentId, envIds),
					columns: {
						mariadbId: true,
						name: true,
						appName: true,
						status: true,
						serverId: true,
						environmentId: true,
					},
				}),
				db.query.mongo.findMany({
					where: inArray(mongo.environmentId, envIds),
					columns: {
						mongoId: true,
						name: true,
						appName: true,
						status: true,
						serverId: true,
						environmentId: true,
					},
				}),
				db.query.redis.findMany({
					where: inArray(redis.environmentId, envIds),
					columns: {
						redisId: true,
						name: true,
						appName: true,
						status: true,
						serverId: true,
						environmentId: true,
					},
				}),
			]);

		type FleetKind =
			| "application"
			| "compose"
			| "postgres"
			| "mysql"
			| "mariadb"
			| "mongo"
			| "redis";

		const base = [
			...appRows.map((row) => ({
				kind: "application" as FleetKind,
				serviceId: row.applicationId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				serverId: row.serverId,
				environmentId: row.environmentId,
			})),
			...composeRows.map((row) => ({
				kind: "compose" as FleetKind,
				serviceId: row.composeId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				serverId: row.serverId,
				environmentId: row.environmentId,
			})),
			...postgresRows.map((row) => ({
				kind: "postgres" as FleetKind,
				serviceId: row.postgresId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				serverId: row.serverId,
				environmentId: row.environmentId,
			})),
			...mysqlRows.map((row) => ({
				kind: "mysql" as FleetKind,
				serviceId: row.mysqlId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				serverId: row.serverId,
				environmentId: row.environmentId,
			})),
			...mariadbRows.map((row) => ({
				kind: "mariadb" as FleetKind,
				serviceId: row.mariadbId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				serverId: row.serverId,
				environmentId: row.environmentId,
			})),
			...mongoRows.map((row) => ({
				kind: "mongo" as FleetKind,
				serviceId: row.mongoId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				serverId: row.serverId,
				environmentId: row.environmentId,
			})),
			...redisRows.map((row) => ({
				kind: "redis" as FleetKind,
				serviceId: row.redisId,
				name: row.name,
				appName: row.appName,
				status: row.status,
				serverId: row.serverId,
				environmentId: row.environmentId,
			})),
		];

		return await Promise.all(
			base.map(async (row) => {
				const environment = envById.get(row.environmentId);
				const projectId = environment?.projectId ?? "";
				const metrics = row.serverId == null ? await readLatestMetricsSample(row.appName) : null;
				return {
					...row,
					projectId,
					projectName: projectNameById.get(projectId) ?? "Unknown",
					environmentName: environment?.name ?? "Unknown",
					metrics: metrics
						? {
								t: metrics.t,
								cpu: metrics.cpu,
								memoryPercent:
									metrics.memoryTotal > 0 ? (metrics.memoryUsed / metrics.memoryTotal) * 100 : 0,
								memoryUsed: metrics.memoryUsed,
								memoryTotal: metrics.memoryTotal,
							}
						: null,
				};
			}),
		);
	}),
});
