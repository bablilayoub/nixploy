import { TRPCError } from "@trpc/server";
import Docker from "dockerode";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { environments, projects } from "../../db/schema";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { findServerById, getServerStatsCached } from "../../modules/cluster";
import { shellQuote } from "../../modules/compose/paths";
import { mapDockerStats } from "../../modules/docker/stats";
import {
	readLatestMetricsSample,
	readMetricsHistory,
	readServerMetricsHistory,
} from "../../modules/monitoring/history";
import { getLocalServerStats } from "../../modules/monitoring/local-host";
import { parseDockerStatsJsonLine } from "../../modules/monitoring/remote";
import { projectIdFilter, resolveCallerOrganizationId } from "../../modules/projects";
import { findServiceByAppName, SERVICE_DEFS } from "../../modules/services/registry";
import { execAsyncRemote } from "../../utils/exec";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

/**
 * Host/container metrics. Remote managed servers are queried over SSH (via
 * the cluster module); the Nixploy host itself is measured by
 * `modules/monitoring/local-host.ts`.
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
			// Org-wide listing: narrow it here, or a team-scoped member sees every
			// service in the organization on the fleet page.
			where: and(eq(projects.organizationId, organizationId), projectIdFilter(projects.projectId)),
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
