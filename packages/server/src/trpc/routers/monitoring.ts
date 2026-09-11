import { readFile } from "node:fs/promises";
import { freemem, loadavg, totalmem } from "node:os";
import { TRPCError } from "@trpc/server";
import Docker from "dockerode";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { environments, projects } from "../../db/schema";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { findServerById, getServerStatsCached, type ServerStats } from "../../modules/cluster";
import { shellQuote } from "../../modules/compose/paths";
import {
	readLatestMetricsSample,
	readMetricsHistory,
	readServerMetricsHistory,
} from "../../modules/monitoring/history";
import { parseDockerStatsJsonLine } from "../../modules/monitoring/remote";
import { resolveCallerOrganizationId } from "../../modules/projects";
import { findServiceByAppName, SERVICE_DEFS } from "../../modules/services/registry";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { mapDockerStats } from "../../ws/docker-stats";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

/**
 * Host/container metrics. Remote managed servers are queried over SSH (via
 * the cluster module); the Nixploy host itself is measured locally with
 * dockerode + /proc + `df` (node-os-utils breaks in Alpine containers).
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

/** Container labels a service's replicas carry, in resolution order (Swarm, compose, stack). */
const REPLICA_LABEL_FILTERS = (appName: string) => [
	`com.docker.swarm.service.name=${appName}`,
	`com.docker.compose.project=${appName}`,
	`com.docker.stack.namespace=${appName}`,
];

interface ReplicaStat {
	id: string;
	name: string;
	state: string;
	cpu: number;
	memoryUsed: number;
	memoryPercent: number;
	pids: number;
}

/**
 * Replica stats of a service pinned to a managed server. Container-level:
 * the replicas run on that node (placement constraint), so `docker ps` and
 * `docker stats` go there over SSH in one round trip.
 */
async function listRemoteReplicaStats(serverId: string, appName: string): Promise<ReplicaStat[]> {
	const lookups = REPLICA_LABEL_FILTERS(appName).map(
		(label) => `docker ps -q --filter ${shellQuote(`label=${label}`)}`,
	);
	const script = [
		`ids=$(${lookups[0]})`,
		...lookups.slice(1).map((lookup) => `[ -n "$ids" ] || ids=$(${lookup})`),
		`[ -n "$ids" ] || exit 0`,
		`docker stats --no-stream --format '{{json .}}' $ids`,
	].join("; ");
	const raw = await execAsyncRemote(serverId, script, { timeoutMs: 30_000 });
	const stats: ReplicaStat[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const frame = parseDockerStatsJsonLine(trimmed);
		if (!frame) continue;
		const { ID = "", Name = "" } = JSON.parse(trimmed) as { ID?: string; Name?: string };
		stats.push({
			id: ID.slice(0, 12),
			name: Name || ID.slice(0, 12),
			state: "running", // `docker ps -q` only lists running containers
			cpu: frame.cpu,
			memoryUsed: frame.memoryUsed,
			memoryPercent: frame.memoryTotal > 0 ? (frame.memoryUsed / frame.memoryTotal) * 100 : 0,
			pids: frame.pids,
		});
	}
	return stats;
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

	/**
	 * Per-replica stats: one-shot stats for every task container of a
	 * service (local host only; empty for remote or single containers).
	 */
	replicaStats: protectedProcedure
		.input(z.object({ appName: z.string().min(1), serverId: z.string().nullish() }))
		.query(async ({ ctx, input }): Promise<ReplicaStat[]> => {
			const organizationId = await getOrganizationId(ctx.session);
			const found = await findServiceByAppName(input.appName);
			const owner = found?.organizationId === organizationId ? found : undefined;
			if (!owner) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
			}

			// Pinned services: the replicas run on the row's server, not
			// wherever the client asked — the row is the source of truth.
			const serverId = owner.serverId ?? null;
			if (serverId) {
				await findServerOrThrow(serverId, organizationId);
				return await listRemoteReplicaStats(serverId, input.appName);
			}

			let containers: Docker.ContainerInfo[] = [];
			for (const label of REPLICA_LABEL_FILTERS(input.appName)) {
				containers = await docker.listContainers({ filters: { label: [label] } });
				if (containers.length > 0) break;
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
	 * Historical metrics of a service (local and remote-hosted), sampled
	 * every 30s and kept for 48h by the metrics-history cron.
	 */
	history: protectedProcedure
		.input(z.object({ appName: z.string().min(1), hours: z.number().min(0.5).max(48) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const found = await findServiceByAppName(input.appName);
			const owner = found?.organizationId === organizationId ? found : undefined;
			if (!owner) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
			}
			return await readMetricsHistory(input.appName, input.hours);
		}),

	/**
	 * Host-level history of a managed server (cpu/memory/disk), sampled over
	 * SSH by the metrics-history cron when the server's metrics are enabled.
	 */
	serverHistory: protectedProcedure
		.input(z.object({ serverId: z.string().min(1), hours: z.number().min(0.5).max(48) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await findServerOrThrow(input.serverId, organizationId);
			return await readServerMetricsHistory(input.serverId, input.hours);
		}),

	/**
	 * Org-wide fleet: every service with status + latest metrics sample
	 * (local services via dockerode, remote via the SSH sampling batch).
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

		const base = (
			await Promise.all(SERVICE_DEFS.map((def) => def.module.listSummaries(envIds)))
		).flat();

		return await Promise.all(
			base.map(async (row) => {
				const environment = envById.get(row.environmentId);
				const projectId = environment?.projectId ?? "";
				const metrics = await readLatestMetricsSample(row.appName);
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
