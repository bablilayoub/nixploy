import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../application/paths";

/**
 * Append-only JSONL store for metrics history.
 *
 * The old writer read, parsed, filtered and **rewrote the whole file** on
 * every sample — every 30 s, for every service plus one file per managed
 * server (audit #2). At 48 h retention that is ~5 760 lines (~0.5 MB) of
 * parse-and-rewrite per service per pass, and the readers parsed the whole
 * file again per request.
 *
 * What this module does instead:
 * - **append** one line (`appendFile`), never a rewrite;
 * - **compact** at most once an hour per file: rewrite it without the points
 *   that fell out of the retention window, through a temp file + `rename` so
 *   a reader never sees a half-written file;
 * - keep a small **in-memory ring** of the newest points per file so
 *   `latest` / fleet overviews answer without touching the disk. The ring is
 *   a pure cache: every point is already on disk when it lands there, so
 *   nothing needs persisting at shutdown — a cold process just refills it
 *   from the file tail;
 * - **read from the tail**: seek `size - chunk` and grow the chunk until the
 *   window is covered, instead of parsing megabytes to answer "the last hour".
 */

export interface TimePoint {
	/** Epoch milliseconds. */
	t: number;
}

/** Points kept in memory per file (~2 h at the 30 s sample cadence). */
export const RING_LIMIT = 240;
/** How often a file is rewritten to drop points past the retention window. */
export const COMPACTION_INTERVAL_MS = 60 * 60 * 1000;
/** First (and, for `latest`, only) tail read size. */
export const TAIL_CHUNK_BYTES = 64 * 1024;
/** Upper bound for a windowed read that keeps needing more history. */
const MAX_TAIL_BYTES = 8 * 1024 * 1024;

const rings = new Map<string, TimePoint[]>();
const compactedAt = new Map<string, number>();

/** Drop every in-memory ring and compaction timer (tests). */
export function resetMetricsStore(): void {
	rings.clear();
	compactedAt.clear();
}

function pushRing(file: string, point: TimePoint): void {
	const ring = rings.get(file) ?? [];
	ring.push(point);
	if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);
	rings.set(file, ring);
}

function parseLines<P extends TimePoint>(text: string): P[] {
	const points: P[] = [];
	for (const line of text.split("\n")) {
		if (!line) continue;
		try {
			const point = JSON.parse(line) as P;
			if (typeof point?.t === "number") points.push(point);
		} catch {
			// Torn or corrupted line (a crash mid-write) — skip it.
		}
	}
	return points;
}

/**
 * Append one sample and, at most hourly, compact the file to `retentionMs`.
 * Compaction failures are swallowed: losing a trim is not worth losing a
 * sampling pass.
 */
export async function appendPoint<P extends TimePoint>(
	file: string,
	point: P,
	options: { retentionMs: number; now?: number },
): Promise<void> {
	const now = options.now ?? Date.now();
	await mkdir(path.dirname(file), { recursive: true });
	await appendFile(file, `${JSON.stringify(point)}\n`, "utf8");
	pushRing(file, point);

	// `compactedAt` starts unset, so the first append after a boot also trims
	// whatever the previous process left behind.
	if (now - (compactedAt.get(file) ?? 0) < COMPACTION_INTERVAL_MS) return;
	compactedAt.set(file, now);
	await compactFile(file, now - options.retentionMs);
}

/** Rewrite `file` without the points older than `cutoff` (temp + rename). */
export async function compactFile(file: string, cutoff: number): Promise<number> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch {
		return 0; // nothing written yet
	}
	const kept: string[] = [];
	let dropped = 0;
	for (const line of text.split("\n")) {
		if (!line) continue;
		try {
			const point = JSON.parse(line) as TimePoint;
			if (typeof point?.t === "number" && point.t >= cutoff) kept.push(line);
			else dropped += 1;
		} catch {
			dropped += 1;
		}
	}
	if (dropped === 0) return 0;
	const temp = `${file}.tmp`;
	await writeFile(temp, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
	await rename(temp, file);
	// The ring only ever holds recent points; compaction cannot invalidate it.
	return dropped;
}

/**
 * Points at or after `cutoff`, read from the end of the file: one 64 KiB
 * chunk usually covers hours, and the chunk grows (×4) only while the oldest
 * line read is still inside the window.
 */
export async function readPointsSince<P extends TimePoint>(
	file: string,
	cutoff: number,
	options: { maxBytes?: number } = {},
): Promise<P[]> {
	const maxBytes = options.maxBytes ?? MAX_TAIL_BYTES;
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(file, "r");
		const { size } = await handle.stat();
		if (size === 0) return [];

		let chunk = Math.min(size, TAIL_CHUNK_BYTES);
		for (;;) {
			const start = size - chunk;
			const buffer = Buffer.alloc(chunk);
			await handle.read(buffer, 0, chunk, start);
			let text = buffer.toString("utf8");
			if (start > 0) {
				// The first line of a mid-file chunk is almost always partial.
				const newline = text.indexOf("\n");
				text = newline === -1 ? "" : text.slice(newline + 1);
			}
			const points = parseLines<P>(text);
			const oldest = points[0]?.t;
			const covered = start === 0 || (oldest !== undefined && oldest < cutoff);
			if (covered || chunk >= maxBytes || chunk >= size) {
				return points.filter((point) => point.t >= cutoff);
			}
			chunk = Math.min(size, chunk * 4);
		}
	} catch {
		return []; // no history yet (or unreadable)
	} finally {
		await handle?.close().catch(() => {});
	}
}

/** Newest sample: the in-memory ring when warm, one short tail read otherwise. */
export async function readLatestPoint<P extends TimePoint>(file: string): Promise<P | null> {
	const ring = rings.get(file);
	const cached = ring?.[ring.length - 1];
	if (cached) return cached as P;

	const points = await readPointsSince<P>(file, 0, { maxBytes: TAIL_CHUNK_BYTES });
	const latest = points[points.length - 1];
	if (!latest) return null;
	// Warm the ring so the next fleet overview skips the disk entirely.
	for (const point of points.slice(-RING_LIMIT)) pushRing(file, point);
	return latest;
}

/** In-memory ring for `file` (newest last) — used by tests and fleet reads. */
export function ringPoints<P extends TimePoint>(file: string): P[] {
	return (rings.get(file) ?? []) as P[];
}

// ── metrics history files ───────────────────────────────────────────────────
//
// The layer above the generic JSONL primitives: where a service's / a managed
// server's samples live on disk, the stored point shapes and the read API the
// monitoring router serves. Written by `./sampler.ts`.

export const METRICS_RETENTION_MS = 48 * 60 * 60 * 1000;

/** Most points one read returns; longer windows are downsampled to it. */
const MAX_POINTS_PER_READ = 240;

/** One stored sample of a service (short keys: 48 h × 30 s adds up). */
export interface HistoryPoint extends TimePoint {
	cpu: number;
	mu: number; // memory used, bytes
	mt: number; // memory total, bytes
	rx: number; // cumulative network rx, bytes
	tx: number; // cumulative network tx, bytes
	br?: number; // cumulative block read, bytes (absent in older points)
	bw?: number; // cumulative block write, bytes
	pids?: number;
}

export interface HistorySample {
	t: number;
	cpu: number;
	memoryUsed: number;
	memoryTotal: number;
	rx: number;
	tx: number;
	blockRead: number;
	blockWrite: number;
	pids: number;
}

/** One stored host-level sample of a managed server. */
export interface ServerHistoryPoint extends TimePoint {
	cpu: number; // busy percent over the sample window
	mu: number; // memory used, bytes
	mt: number; // memory total, bytes
	du: number; // disk used (/), bytes
	dt: number; // disk total (/), bytes
}

export interface ServerHistorySample {
	t: number;
	cpuPercent: number;
	memoryUsed: number;
	memoryTotal: number;
	diskUsed: number;
	diskTotal: number;
}

const metricsDir = () => path.join(getConfigDir(), "metrics");
export const metricsFile = (appName: string) => path.join(metricsDir(), `${appName}.jsonl`);
/** Host-level history of a managed server lives next to the service files. */
export const serverMetricsFile = (serverId: string) =>
	path.join(metricsDir(), `server-${serverId}.jsonl`);

export const appendServicePoint = (appName: string, point: HistoryPoint): Promise<void> =>
	appendPoint(metricsFile(appName), point, { retentionMs: METRICS_RETENTION_MS });

export const appendServerPoint = (serverId: string, point: ServerHistoryPoint): Promise<void> =>
	appendPoint(serverMetricsFile(serverId), point, { retentionMs: METRICS_RETENTION_MS });

/** Uniform-stride downsample to at most {@link MAX_POINTS_PER_READ} points. */
function downsample<P>(points: P[]): P[] {
	if (points.length <= MAX_POINTS_PER_READ) return points;
	const stride = points.length / MAX_POINTS_PER_READ;
	const sampled: P[] = [];
	for (let index = 0; index < MAX_POINTS_PER_READ; index++) {
		const point = points[Math.floor(index * stride)];
		if (point) sampled.push(point);
	}
	return sampled;
}

const toSample = (point: HistoryPoint): HistorySample => ({
	t: point.t,
	cpu: point.cpu,
	memoryUsed: point.mu,
	memoryTotal: point.mt,
	rx: point.rx,
	tx: point.tx,
	blockRead: point.br ?? 0,
	blockWrite: point.bw ?? 0,
	pids: point.pids ?? 0,
});

const toServerSample = (point: ServerHistoryPoint): ServerHistorySample => ({
	t: point.t,
	cpuPercent: point.cpu,
	memoryUsed: point.mu,
	memoryTotal: point.mt,
	diskUsed: point.du,
	diskTotal: point.dt,
});

/**
 * Read the last `hours` of history for a service, downsampled to at most
 * MAX_POINTS_PER_READ points (uniform stride). Seeks from the end of the
 * file instead of parsing the whole 48 h window (audit #2).
 */
export async function readMetricsHistory(appName: string, hours: number): Promise<HistorySample[]> {
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	const points = await readPointsSince<HistoryPoint>(metricsFile(appName), cutoff);
	return downsample(points).map(toSample);
}

/**
 * Most recent metrics sample for a service, or null when no history exists.
 * Served from the in-memory ring when the sampler has already written this
 * process's first point — `fleetOverview` calls this once per service.
 */
export async function readLatestMetricsSample(appName: string): Promise<HistorySample | null> {
	const point = await readLatestPoint<HistoryPoint>(metricsFile(appName));
	return point ? toSample(point) : null;
}

/**
 * Read the last `hours` of host-level history for a managed server,
 * downsampled like service history.
 */
export async function readServerMetricsHistory(
	serverId: string,
	hours: number,
): Promise<ServerHistorySample[]> {
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	const points = await readPointsSince<ServerHistoryPoint>(serverMetricsFile(serverId), cutoff);
	return downsample(points).map(toServerSample);
}
