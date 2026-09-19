import { createReadStream, createWriteStream } from "node:fs";
import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { getConfigDir } from "../application/paths";
import { encodeLogLine, parseLogLines, type RuntimeLogLine } from "./format";
import { type LogQuery, matchLogLine } from "./query";

/**
 * Runtime log history: files, not rows.
 *
 * `<config>/runtime-logs/<appName>/<YYYY-MM-DDTHH>.jsonl`, one line per log
 * line, appended by the harvester; an hour that has closed is gzipped in
 * place (`.jsonl.gz`). Reads go newest-first over the hour files and stop at
 * the first page, so "the last 200 error lines" never parses a day of
 * output. Retention is by age and by bytes per service, instance-wide —
 * the same shape as the metrics store next door.
 */

/** Postgres/Docker-safe app names only — the name becomes a directory. */
const SAFE_APP_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const assertRuntimeLogAppName = (appName: string): string => {
	if (!SAFE_APP_NAME.test(appName)) throw new Error(`Unsafe app name for runtime logs: ${appName}`);
	return appName;
};

export const getRuntimeLogsDir = (): string => path.join(getConfigDir(), "runtime-logs");

export const serviceLogDir = (appName: string): string =>
	path.join(getRuntimeLogsDir(), assertRuntimeLogAppName(appName));

/** `2026-09-19T21` — the hour bucket a timestamp lands in (UTC). */
export const hourKey = (t: number): string => new Date(t).toISOString().slice(0, 13);

const HOUR_FILE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2})\.jsonl(\.gz)?$/;

interface HourFile {
	name: string;
	hour: string;
	gzipped: boolean;
}

async function listHourFiles(dir: string): Promise<HourFile[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const files: HourFile[] = [];
	for (const name of names) {
		const match = HOUR_FILE_RE.exec(name);
		if (!match) continue;
		files.push({ name, hour: match[1] ?? "", gzipped: Boolean(match[2]) });
	}
	return files;
}

// ── write ───────────────────────────────────────────────────────────────────

/** Append lines to their hour files (created on demand). Lines may span hours. */
export async function appendRuntimeLogLines(
	appName: string,
	lines: readonly RuntimeLogLine[],
): Promise<void> {
	if (lines.length === 0) return;
	const dir = serviceLogDir(appName);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const byHour = new Map<string, string[]>();
	for (const line of lines) {
		const key = hourKey(line.t);
		const bucket = byHour.get(key) ?? [];
		bucket.push(encodeLogLine(line));
		byHour.set(key, bucket);
	}
	for (const [hour, encoded] of byHour) {
		await appendFile(path.join(dir, `${hour}.jsonl`), `${encoded.join("\n")}\n`, { mode: 0o600 });
	}
}

/**
 * Gzip every plain hour file of a service whose hour has closed. Through a
 * temp file + rename so a reader never sees a half-written archive; the
 * plain file goes last, so a crash in between leaves both (the reader
 * prefers the archive when both exist).
 */
export async function sealClosedHours(appName: string, now = Date.now()): Promise<number> {
	const dir = serviceLogDir(appName);
	const current = hourKey(now);
	let sealed = 0;
	for (const file of await listHourFiles(dir)) {
		if (file.gzipped || file.hour >= current) continue;
		const source = path.join(dir, file.name);
		const target = `${source}.gz`;
		const temp = `${target}.tmp`;
		await pipeline(
			createReadStream(source),
			createGzip(),
			createWriteStream(temp, { mode: 0o600 }),
		);
		await rename(temp, target);
		await rm(source, { force: true });
		sealed += 1;
	}
	return sealed;
}

// ── harvest cursors ─────────────────────────────────────────────────────────

export interface HarvestState {
	/** container id (12 chars) → the Docker timestamp of the last stored line + when it was last seen. */
	cursors: Record<string, { ts: string; seenAt: number }>;
}

const STATE_FILE = "state.json";

export async function readHarvestState(appName: string): Promise<HarvestState> {
	try {
		const raw = await readFile(path.join(serviceLogDir(appName), STATE_FILE), "utf8");
		const parsed = JSON.parse(raw) as Partial<HarvestState>;
		return { cursors: parsed.cursors && typeof parsed.cursors === "object" ? parsed.cursors : {} };
	} catch {
		return { cursors: {} };
	}
}

export async function writeHarvestState(appName: string, state: HarvestState): Promise<void> {
	const dir = serviceLogDir(appName);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const target = path.join(dir, STATE_FILE);
	const temp = `${target}.tmp`;
	await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
	await rename(temp, target);
}

// ── read ────────────────────────────────────────────────────────────────────

export interface ReadRuntimeLogsInput {
	appName: string;
	query?: LogQuery | null;
	/** Only lines older than this (epoch ms) — the cursor of the previous page. */
	before?: number | null;
	limit: number;
	/** Wall-clock budget for one read; a regex over a chatty day stops here. */
	budgetMs?: number;
	/** Lines examined before the read gives up. */
	maxScanned?: number;
}

export interface ReadRuntimeLogsResult {
	/** Newest first. */
	lines: RuntimeLogLine[];
	/** `before` for the next page, or null when the history is exhausted. */
	nextCursor: number | null;
	/** True when the read stopped on its budget rather than on the end of history. */
	truncated: boolean;
	scanned: number;
}

export const DEFAULT_READ_BUDGET_MS = 4_000;
export const DEFAULT_MAX_SCANNED = 500_000;

async function readHourFile(dir: string, file: HourFile): Promise<RuntimeLogLine[]> {
	const raw = await readFile(path.join(dir, file.name)).catch(() => null);
	if (!raw) return [];
	const text = file.gzipped ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
	return parseLogLines(text);
}

/** Newest-first page over the hour files of one service. */
export async function readRuntimeLogs(input: ReadRuntimeLogsInput): Promise<ReadRuntimeLogsResult> {
	const dir = serviceLogDir(input.appName);
	const budgetMs = input.budgetMs ?? DEFAULT_READ_BUDGET_MS;
	const maxScanned = input.maxScanned ?? DEFAULT_MAX_SCANNED;
	const startedAt = Date.now();
	const before = input.before ?? null;
	const beforeHour = before === null ? null : hourKey(before);

	// Prefer the archive when both exist (a crash between gzip and unlink).
	const files = await listHourFiles(dir);
	const byHour = new Map<string, HourFile>();
	for (const file of files) {
		const existing = byHour.get(file.hour);
		if (!existing || file.gzipped) byHour.set(file.hour, file);
	}
	const hours = [...byHour.keys()].sort().reverse();

	const lines: RuntimeLogLine[] = [];
	let scanned = 0;
	let truncated = false;
	let exhausted = true;
	// Everything at or after the last examined line has been seen, whether
	// it matched or not — so it is the honest cursor when a page ends early.
	let lastScannedT: number | null = null;
	for (const hour of hours) {
		if (beforeHour !== null && hour > beforeHour) continue;
		const file = byHour.get(hour);
		if (!file) continue;
		const stored = await readHourFile(dir, file);
		for (let index = stored.length - 1; index >= 0; index -= 1) {
			const line = stored[index];
			if (!line) continue;
			if (before !== null && line.t >= before) continue;
			scanned += 1;
			lastScannedT = line.t;
			if (!input.query || matchLogLine(input.query, line)) {
				lines.push(line);
				if (lines.length >= input.limit) {
					exhausted = false;
					break;
				}
			}
			if (scanned >= maxScanned || Date.now() - startedAt > budgetMs) {
				truncated = true;
				exhausted = false;
				break;
			}
		}
		if (!exhausted) break;
	}
	return {
		lines,
		nextCursor: exhausted ? null : (lastScannedT ?? before ?? null),
		truncated,
		scanned,
	};
}

/** Every service that has history on disk. */
export async function listRuntimeLogServices(): Promise<string[]> {
	try {
		const names = await readdir(getRuntimeLogsDir());
		return names.filter((name) => SAFE_APP_NAME.test(name)).sort();
	} catch {
		return [];
	}
}

/** Bytes on disk per service (plain + archived hours). */
export async function runtimeLogUsage(appName: string): Promise<number> {
	const dir = serviceLogDir(appName);
	let total = 0;
	for (const file of await listHourFiles(dir)) {
		const info = await stat(path.join(dir, file.name)).catch(() => null);
		if (info) total += info.size;
	}
	return total;
}

// ── retention ───────────────────────────────────────────────────────────────

export const DEFAULT_RUNTIME_LOG_RETENTION_DAYS = 7;
export const DEFAULT_RUNTIME_LOG_MAX_MB_PER_SERVICE = 256;

const positiveInt = (raw: string | undefined, fallback: number): number => {
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** `NIXPLOY_RUNTIME_LOG_RETENTION_DAYS` (default 7). */
export const runtimeLogRetentionDays = (): number =>
	positiveInt(process.env.NIXPLOY_RUNTIME_LOG_RETENTION_DAYS, DEFAULT_RUNTIME_LOG_RETENTION_DAYS);

/** `NIXPLOY_RUNTIME_LOG_MAX_MB_PER_SERVICE` (default 256; 0 = no byte cap). */
export const runtimeLogMaxBytesPerService = (): number =>
	positiveInt(
		process.env.NIXPLOY_RUNTIME_LOG_MAX_MB_PER_SERVICE,
		DEFAULT_RUNTIME_LOG_MAX_MB_PER_SERVICE,
	) *
	1024 *
	1024;

export interface PruneRuntimeLogsResult {
	removedFiles: number;
	removedServices: number;
}

/**
 * Drop hour files past the retention window, then the oldest hours of any
 * service over its byte cap; a service directory left with no hours (and no
 * live cursor) goes too, so a deleted service does not linger on disk.
 */
export async function pruneRuntimeLogs(
	options: { retentionDays?: number; maxBytesPerService?: number; now?: number } = {},
): Promise<PruneRuntimeLogsResult> {
	const now = options.now ?? Date.now();
	const retentionDays = options.retentionDays ?? runtimeLogRetentionDays();
	const maxBytes = options.maxBytesPerService ?? runtimeLogMaxBytesPerService();
	const cutoffHour = hourKey(now - retentionDays * 24 * 60 * 60 * 1000);
	const result: PruneRuntimeLogsResult = { removedFiles: 0, removedServices: 0 };

	for (const appName of await listRuntimeLogServices()) {
		const dir = serviceLogDir(appName);
		const files = await listHourFiles(dir);
		const sized: Array<HourFile & { size: number }> = [];
		for (const file of files) {
			const info = await stat(path.join(dir, file.name)).catch(() => null);
			if (info) sized.push({ ...file, size: info.size });
		}
		sized.sort((a, b) => a.hour.localeCompare(b.hour));
		let total = sized.reduce((sum, file) => sum + file.size, 0);
		const remaining: typeof sized = [];
		for (const file of sized) {
			const tooOld = retentionDays > 0 && file.hour < cutoffHour;
			if (tooOld) {
				await rm(path.join(dir, file.name), { force: true });
				result.removedFiles += 1;
				total -= file.size;
				continue;
			}
			remaining.push(file);
		}
		// Oldest first until under the cap; never the current hour.
		const currentHour = hourKey(now);
		while (maxBytes > 0 && total > maxBytes && remaining.length > 0) {
			const oldest = remaining[0];
			if (!oldest || oldest.hour >= currentHour) break;
			remaining.shift();
			await rm(path.join(dir, oldest.name), { force: true });
			result.removedFiles += 1;
			total -= oldest.size;
		}
		if (remaining.length === 0) {
			const state = await readHarvestState(appName);
			const live = Object.values(state.cursors).some(
				(cursor) => now - cursor.seenAt < 24 * 60 * 60 * 1000,
			);
			if (!live) {
				await rm(dir, { recursive: true, force: true });
				result.removedServices += 1;
			}
		}
	}
	return result;
}

/** Remove a service's history outright (service deletion). */
export async function removeRuntimeLogs(appName: string): Promise<void> {
	if (!SAFE_APP_NAME.test(appName)) return;
	await rm(serviceLogDir(appName), { recursive: true, force: true });
}
