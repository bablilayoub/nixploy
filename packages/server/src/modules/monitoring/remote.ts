import { shellQuote } from "../compose/paths";

/**
 * Remote (managed-server) metrics sampling. One SSH batch per server collects
 * host CPU (/proc/stat delta), memory (/proc/meminfo), disk (df) and a
 * one-shot `docker stats` per service container. All parsing lives in pure
 * functions so it is unit-testable without SSH.
 */

export interface RemoteHostSample {
	cpuPercent: number;
	memoryUsed: number;
	memoryTotal: number;
	diskUsed: number;
	diskTotal: number;
}

export interface RemoteContainerFrame {
	cpu: number;
	memoryUsed: number;
	memoryTotal: number;
	rx: number;
	tx: number;
	blockRead: number;
	blockWrite: number;
	pids: number;
}

export interface RemoteSampleResult {
	host: RemoteHostSample | null;
	/** appName → container stats (only services with a running container). */
	services: Map<string, RemoteContainerFrame>;
}

/** Per-server sampling knobs from `server.metricsConfig.metrics`. */
export interface ServerMetricsConfig {
	enabled: boolean;
	intervalSeconds: number;
}

const DEFAULT_INTERVAL_SECONDS = 30;

/** Read `metricsConfig.metrics` — absent/partial config means "on, every pass". */
export function readServerMetricsConfig(metricsConfig: unknown): ServerMetricsConfig {
	if (typeof metricsConfig !== "object" || metricsConfig === null) {
		return { enabled: true, intervalSeconds: DEFAULT_INTERVAL_SECONDS };
	}
	const metrics = (metricsConfig as Record<string, unknown>).metrics;
	if (typeof metrics !== "object" || metrics === null) {
		return { enabled: true, intervalSeconds: DEFAULT_INTERVAL_SECONDS };
	}
	const record = metrics as Record<string, unknown>;
	const interval =
		typeof record.intervalSeconds === "number" &&
		Number.isFinite(record.intervalSeconds) &&
		record.intervalSeconds >= DEFAULT_INTERVAL_SECONDS
			? Math.floor(record.intervalSeconds)
			: DEFAULT_INTERVAL_SECONDS;
	return {
		enabled: record.enabled !== false,
		intervalSeconds: interval,
	};
}

/**
 * Parse a docker-style byte size ("12.3MiB", "1.2kB", "0B", "4.5GB").
 * `i`-suffixed units are 1024-based; bare metric units (kB, MB, …) are
 * 1000-based — matching docker's go-units display.
 */
export function parseByteSize(text: string): number {
	const match = text.trim().match(/^([\d.]+)\s*([a-zA-Z]*)$/);
	if (!match) return 0;
	const value = Number(match[1]);
	if (!Number.isFinite(value)) return 0;
	const unit = (match[2] ?? "B").toLowerCase();
	const binary: Record<string, number> = {
		b: 1,
		kib: 1024,
		mib: 1024 ** 2,
		gib: 1024 ** 3,
		tib: 1024 ** 4,
	};
	const decimal: Record<string, number> = {
		kb: 1000,
		mb: 1000 ** 2,
		gb: 1000 ** 3,
		tb: 1000 ** 4,
	};
	const factor = binary[unit] ?? decimal[unit];
	return factor ? Math.round(value * factor) : 0;
}

/** Split a "12.3MiB / 7.6GiB" pair into [used, total] bytes. */
export function parseUsagePair(text: string): [number, number] {
	const [used, total] = text.split("/").map((part) => parseByteSize(part ?? ""));
	return [used ?? 0, total ?? 0];
}

interface ProcStatCpu {
	idle: number;
	total: number;
}

/** Parse the aggregate `cpu  user nice system idle iowait …` line of /proc/stat. */
export function parseProcStatCpuLine(line: string): ProcStatCpu | null {
	const parts = line.trim().split(/\s+/);
	if (parts[0] !== "cpu" || parts.length < 5) return null;
	const values = parts.slice(1).map(Number);
	if (values.some((v) => !Number.isFinite(v))) return null;
	const idle = (values[3] ?? 0) + (values[4] ?? 0); // idle + iowait
	const total = values.reduce((sum, v) => sum + v, 0);
	return total > 0 ? { idle, total } : null;
}

/** Busy percentage between two cumulative /proc/stat snapshots (0–100). */
export function cpuPercentBetween(prev: ProcStatCpu, next: ProcStatCpu): number {
	const totalDelta = next.total - prev.total;
	const idleDelta = next.idle - prev.idle;
	if (totalDelta <= 0) return 0;
	return Math.min(100, Math.max(0, ((totalDelta - idleDelta) / totalDelta) * 100));
}

/** Parse MemTotal/MemAvailable from /proc/meminfo (kB values). */
export function parseMeminfo(text: string): {
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
} {
	const kb = (key: string): number => {
		const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
		return match ? Number(match[1]) * 1024 : 0;
	};
	const totalBytes = kb("MemTotal");
	const availableBytes = kb("MemAvailable") || kb("MemFree");
	return {
		totalBytes,
		usedBytes: Math.max(0, totalBytes - availableBytes),
		availableBytes,
	};
}

/** Parse one `df -Pk /` data line (1024-byte blocks). */
export function parseDfLine(line: string): {
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
} {
	const parts = line.trim().split(/\s+/);
	// Filesystem 1024-blocks Used Available Use% Mounted
	if (parts.length < 5) return { totalBytes: 0, usedBytes: 0, availableBytes: 0 };
	const totalKb = Number(parts[1]);
	const usedKb = Number(parts[2]);
	const availableKb = Number(parts[3]);
	if (!Number.isFinite(totalKb) || totalKb <= 0) {
		return { totalBytes: 0, usedBytes: 0, availableBytes: 0 };
	}
	return {
		totalBytes: totalKb * 1024,
		usedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : 0,
		availableBytes: Number.isFinite(availableKb) ? availableKb * 1024 : 0,
	};
}

/** Parse one `docker stats --no-stream --format '{{json .}}'` line. */
export function parseDockerStatsJsonLine(line: string): RemoteContainerFrame | null {
	let parsed: Record<string, string>;
	try {
		parsed = JSON.parse(line) as Record<string, string>;
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const [memoryUsed, memoryTotal] = parseUsagePair(parsed.MemUsage ?? "");
	const [rx, tx] = parseUsagePair(parsed.NetIO ?? "");
	const [blockRead, blockWrite] = parseUsagePair(parsed.BlockIO ?? "");
	return {
		cpu: Number.parseFloat(parsed.CPUPerc ?? "0") || 0,
		memoryUsed,
		memoryTotal,
		rx,
		tx,
		blockRead,
		blockWrite,
		pids: Number.parseInt(parsed.PIDs ?? "0", 10) || 0,
	};
}

const SECTION_RE = /^==([A-Z_]+)==\s*(.*)$/;

/**
 * Parse the full batch output of {@link buildRemoteSampleCommand}.
 * `appNames` whitelists SVC markers so a hostile container name cannot
 * inject a section for an unrelated service.
 */
export function parseRemoteSampleOutput(raw: string, appNames: string[]): RemoteSampleResult {
	const allowed = new Set(appNames);
	let cpuA: ProcStatCpu | null = null;
	let cpuB: ProcStatCpu | null = null;
	let memText = "";
	let diskParsed = { totalBytes: 0, usedBytes: 0, availableBytes: 0 };
	const services = new Map<string, RemoteContainerFrame>();

	let section = "";
	let currentService: string | null = null;
	for (const line of raw.split("\n")) {
		const marker = line.match(SECTION_RE);
		if (marker) {
			section = marker[1] ?? "";
			if (section === "SVC") {
				const name = (marker[2] ?? "").trim();
				currentService = allowed.has(name) ? name : null;
			} else {
				currentService = null;
			}
			continue;
		}
		switch (section) {
			case "CPU_A": {
				const parsed = parseProcStatCpuLine(line);
				if (parsed) cpuA = parsed;
				break;
			}
			case "CPU_B": {
				const parsed = parseProcStatCpuLine(line);
				if (parsed) cpuB = parsed;
				break;
			}
			case "MEM":
				memText += `${line}\n`;
				break;
			case "DF": {
				const parsed = parseDfLine(line);
				if (parsed.totalBytes > 0) diskParsed = parsed;
				break;
			}
			case "SVC": {
				if (!currentService || services.has(currentService)) break;
				const frame = parseDockerStatsJsonLine(line);
				if (frame) services.set(currentService, frame);
				break;
			}
		}
	}

	const memory = parseMeminfo(memText);
	const hasHost =
		(cpuA !== null && cpuB !== null) || memory.totalBytes > 0 || diskParsed.totalBytes > 0;
	return {
		host: hasHost
			? {
					cpuPercent: cpuA && cpuB ? cpuPercentBetween(cpuA, cpuB) : 0,
					memoryUsed: memory.usedBytes,
					memoryTotal: memory.totalBytes,
					diskUsed: diskParsed.usedBytes,
					diskTotal: diskParsed.totalBytes,
				}
			: null,
		services,
	};
}

/**
 * One SSH batch: host /proc/stat delta (1s), meminfo, df and a one-shot
 * `docker stats` for the first container matching each service's labels.
 */
export function buildRemoteSampleCommand(appNames: string[]): string {
	const lines = [
		"echo '==CPU_A=='",
		"grep '^cpu ' /proc/stat",
		"sleep 1",
		"echo '==CPU_B=='",
		"grep '^cpu ' /proc/stat",
		"echo '==MEM=='",
		"grep -E '^(MemTotal|MemAvailable|MemFree):' /proc/meminfo",
		"echo '==DF=='",
		"df -Pk / 2>/dev/null | tail -n 1",
	];
	for (const appName of appNames) {
		const quoted = shellQuote(appName);
		lines.push(
			`echo '==SVC==${appName}'`,
			`cid=$(docker ps -q --filter label=com.docker.swarm.service.name=${quoted} 2>/dev/null | head -n 1)`,
			`[ -z "$cid" ] && cid=$(docker ps -q --filter label=com.docker.compose.project=${quoted} 2>/dev/null | head -n 1)`,
			`[ -z "$cid" ] && cid=$(docker ps -q --filter label=com.docker.stack.namespace=${quoted} 2>/dev/null | head -n 1)`,
			`[ -n "$cid" ] && docker stats --no-stream --format '{{json .}}' "$cid" 2>/dev/null | head -n 1`,
		);
	}
	return lines.join("; ");
}
