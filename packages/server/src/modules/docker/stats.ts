import type Docker from "dockerode";

/**
 * Normalized container stats frame and the dockerode → frame mapping.
 *
 * Lives under `modules/` (not `ws/`) because the metrics cron and the
 * monitoring router need it too, and a module must never import the
 * transport layer (audit F5).
 */

export interface ContainerStatsFrame {
	cpu: number;
	memory: { used: number; total: number; percent: number };
	network: { rx: number; tx: number };
	/** Cumulative block-device I/O, bytes. */
	block: { read: number; write: number };
	/** Processes/threads inside the container. */
	pids: number;
}

/** Compute cpu/memory/network from a dockerode stats payload (mirrors `docker stats`). */
export function mapDockerStats(stats: Docker.ContainerStats): ContainerStatsFrame {
	const cpuDelta =
		stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage ?? 0);
	const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage ?? 0);
	const onlineCpus =
		stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
	const cpu = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

	const used = stats.memory_stats.usage - (stats.memory_stats.stats?.cache ?? 0);
	const total = stats.memory_stats.limit;
	const percent = total > 0 ? (used / total) * 100 : 0;

	let rx = 0;
	let tx = 0;
	for (const iface of Object.values(stats.networks ?? {})) {
		rx += iface.rx_bytes;
		tx += iface.tx_bytes;
	}

	let blockRead = 0;
	let blockWrite = 0;
	for (const entry of stats.blkio_stats?.io_service_bytes_recursive ?? []) {
		if (entry.op === "Read") blockRead += entry.value;
		if (entry.op === "Write") blockWrite += entry.value;
	}

	return {
		cpu,
		memory: { used, total, percent },
		network: { rx, tx },
		block: { read: blockRead, write: blockWrite },
		pids: stats.pids_stats?.current ?? 0,
	};
}
