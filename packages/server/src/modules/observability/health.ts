import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import { execAsync } from "../../utils/exec";
import { getDocker } from "../deployment/docker";
import { queueDepth } from "../deployment/queue";
import { getAppVersion } from "../updates/check";

/**
 * Platform health for `GET /api/health` (liveness), `GET /api/ready`
 * (readiness) and `GET /api/version`. Unauthenticated by design, so nothing
 * here may leak configuration: errors are reduced to their message, never a
 * stack, DSN or host name.
 *
 * Readiness answers "can this process serve the panel right now":
 * - `database`   `SELECT 1` through the pool                        → fails readiness
 * - `docker`     `docker.ping()` on the host socket                  → fails readiness
 * - `migrations` journal on disk vs `drizzle.__drizzle_migrations`  → fails when behind
 * - `queue`      in-memory deploy queue + rows stuck in `running`   → warning only
 * - `traefik`    `nixploy-traefik` Swarm service present            → fails only when
 *                the panel bootstraps Traefik itself (see {@link traefikRequired})
 * - `platform`   platform self-alerts from the 5-minute cron        → warning only
 *                (disk, queue age, certificate expiry, platform services, backups —
 *                `modules/monitoring/platform-alerts.ts` persists the state, this
 *                only reports it, so readiness never runs `df` or `docker service ls`)
 *
 * The aggregate is cached for {@link READINESS_CACHE_MS} so Swarm health
 * probes, `update.sh`, the CLI and dashboards polling at once cost one pass.
 */

export const READINESS_CACHE_MS = 5_000;
export const TRAEFIK_PROBE_CACHE_MS = 10_000;
/** A `running` deployment row older than this is reported as stuck (warning). */
export const STUCK_DEPLOYMENT_AFTER_MS = 90 * 60 * 1000;
/** Per-check budget so one hung dependency cannot stall the whole probe. */
export const CHECK_TIMEOUT_MS = 4_000;

export interface CheckResult {
	ok: boolean;
	latencyMs?: number;
	/** Present when the check failed; safe for unauthenticated output. */
	error?: string;
	/** Present when the check passed with a caveat. */
	warning?: string;
}

export type MigrationState = "current" | "behind" | "ahead" | "unknown";

export interface MigrationInfo {
	state: MigrationState;
	/** Rows in `drizzle.__drizzle_migrations`. */
	applied: number | null;
	/** Entries in the journal shipped with this build. */
	expected: number | null;
}

export interface QueueInfo {
	pending: number;
	running: number;
	/** Rows still `running` after {@link STUCK_DEPLOYMENT_AFTER_MS}. */
	stuck: number;
}

export interface TraefikInfo {
	/** True when the panel bootstraps Traefik itself (absence is then a failure). */
	required: boolean;
	present: boolean | null;
}

/** Alert summaries from the platform-alert cron; no paths, no configuration. */
export interface PlatformAlertsInfo {
	/** ISO timestamp of the last evaluation pass, null when it never ran. */
	evaluatedAt: string | null;
	alerts: Array<{ kind: string; severity: string; summary: string }>;
}

export interface ReadinessReport {
	ok: boolean;
	checkedAt: string;
	/** Names of the checks that failed (empty when `ok`). */
	failing: string[];
	checks: {
		database: CheckResult;
		docker: CheckResult;
		migrations: CheckResult & MigrationInfo;
		queue: CheckResult & QueueInfo;
		traefik: CheckResult & TraefikInfo;
		platform: CheckResult & PlatformAlertsInfo;
	};
}

/** Raw probe results before aggregation — every probe may throw. */
export interface ReadinessProbes {
	pingDatabase: () => Promise<void>;
	pingDocker: () => Promise<void>;
	readMigrations: () => Promise<MigrationInfo>;
	readQueue: () => Promise<QueueInfo>;
	/** `null` when Traefik is not probed (not required and docker unreachable). */
	traefikPresent: () => Promise<boolean | null>;
	traefikRequired: () => boolean;
	/** Last persisted platform-alert pass (file read only — never re-evaluates). */
	readPlatformAlerts: () => Promise<PlatformAlertsInfo>;
	now?: () => number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Message for the public report: first non-empty line only (a docker CLI
 * failure echoes its whole stderr), capped so a probe cannot bloat the JSON.
 */
const errorMessage = (error: unknown): string => {
	const raw = error instanceof Error && error.message ? error.message : String(error);
	const line = raw
		.split("\n")
		.map((part) => part.trim())
		.find((part) => part.length > 0 && !/^Command failed:/.test(part));
	return (line ?? raw.trim()).slice(0, 300);
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

/** Run a probe under the per-check budget, folding any throw into `{ ok: false }`. */
async function timed<T>(
	label: string,
	probe: () => Promise<T>,
	now: () => number,
): Promise<{ result: CheckResult; value: T | null }> {
	const startedAt = now();
	try {
		const value = await withTimeout(probe(), CHECK_TIMEOUT_MS, label);
		return { result: { ok: true, latencyMs: now() - startedAt }, value };
	} catch (error) {
		return {
			result: { ok: false, latencyMs: now() - startedAt, error: errorMessage(error) },
			value: null,
		};
	}
}

/**
 * Traefik is the panel's responsibility only when it bootstraps the proxy on
 * boot (`server.ts#initTraefik`). The production image and install.sh set
 * `NIXPLOY_DISABLE_TRAEFIK_BOOT=1` because install.sh owns the service; there
 * the probe is informational (a warning, never a 503) so a proxy outage does
 * not make Swarm restart a perfectly healthy panel.
 */
export const traefikRequired = (env: NodeJS.ProcessEnv = process.env): boolean =>
	!env.NIXPLOY_DISABLE_TRAEFIK_BOOT;

// ─── Aggregation (pure) ──────────────────────────────────────────────────────

/**
 * Run every probe (in parallel) and fold the results into one report. Pure
 * apart from the injected probes, so the failure matrix is unit-testable.
 */
export async function runReadinessChecks(probes: ReadinessProbes): Promise<ReadinessReport> {
	const now = probes.now ?? Date.now;
	const required = probes.traefikRequired();

	const [database, docker, migrations, queue, traefik, platform] = await Promise.all([
		timed("database", probes.pingDatabase, now),
		timed("docker", probes.pingDocker, now),
		timed("migrations", probes.readMigrations, now),
		timed("queue", probes.readQueue, now),
		timed("traefik", probes.traefikPresent, now),
		timed("platform", probes.readPlatformAlerts, now),
	]);

	const migrationInfo: MigrationInfo = migrations.value ?? {
		state: "unknown",
		applied: null,
		expected: null,
	};
	const migrationsCheck: CheckResult & MigrationInfo = { ...migrations.result, ...migrationInfo };
	if (migrations.result.ok) {
		if (migrationInfo.state === "behind") {
			migrationsCheck.ok = false;
			migrationsCheck.error = `Database schema is behind this build (${migrationInfo.applied ?? 0}/${migrationInfo.expected ?? "?"} migrations applied) — the migration step did not complete`;
		} else if (migrationInfo.state === "ahead") {
			migrationsCheck.warning =
				"Database schema is newer than this build (a newer version ran its migrations) — restore the pre-update dump or roll forward";
		} else if (migrationInfo.state === "unknown") {
			migrationsCheck.warning = "Migration state could not be determined";
		}
	}

	const queueInfo: QueueInfo = queue.value ?? { pending: 0, running: 0, stuck: 0 };
	const queueCheck: CheckResult & QueueInfo = { ...queue.result, ...queueInfo };
	if (!queue.result.ok) {
		// The queue itself is in-memory and always answers; only the stuck-row
		// lookup can fail (DB down — already reported by `database`).
		queueCheck.ok = true;
		queueCheck.warning = `Stuck-deployment lookup failed: ${queue.result.error ?? "unknown error"}`;
		delete queueCheck.error;
	} else if (queueInfo.stuck > 0) {
		queueCheck.warning = `${queueInfo.stuck} deployment(s) have been running for more than ${Math.round(STUCK_DEPLOYMENT_AFTER_MS / 60_000)} minutes`;
	}

	const present = traefik.result.ok ? traefik.value : null;
	const traefikCheck: CheckResult & TraefikInfo = {
		...traefik.result,
		required,
		present,
	};
	if (traefik.result.ok && present === false) {
		if (required) {
			traefikCheck.ok = false;
			traefikCheck.error = "Swarm service nixploy-traefik is not running";
		} else {
			traefikCheck.warning = "Swarm service nixploy-traefik was not found";
		}
	} else if (!traefik.result.ok && !required) {
		traefikCheck.ok = true;
		traefikCheck.warning = `Traefik probe failed: ${traefik.result.error ?? "unknown error"}`;
		delete traefikCheck.error;
	}

	// Platform self-alerts are advisory: a full disk or an expiring certificate
	// must not make Swarm restart an otherwise healthy panel, so this check is
	// always `ok` and speaks through `warning`.
	const platformInfo: PlatformAlertsInfo = platform.value ?? { evaluatedAt: null, alerts: [] };
	const platformCheck: CheckResult & PlatformAlertsInfo = {
		...platform.result,
		...platformInfo,
		ok: true,
	};
	delete platformCheck.error;
	if (!platform.result.ok) {
		platformCheck.warning = `Platform alert state could not be read: ${platform.result.error ?? "unknown error"}`;
	} else if (platformInfo.alerts.length > 0) {
		const critical = platformInfo.alerts.filter((alert) => alert.severity === "critical").length;
		platformCheck.warning = `${platformInfo.alerts.length} platform alert(s) active${critical > 0 ? ` (${critical} critical)` : ""}: ${platformInfo.alerts.map((alert) => alert.kind).join(", ")}`;
	}

	const checks: ReadinessReport["checks"] = {
		database: database.result,
		docker: docker.result,
		migrations: migrationsCheck,
		queue: queueCheck,
		traefik: traefikCheck,
		platform: platformCheck,
	};
	const failing = (Object.keys(checks) as Array<keyof typeof checks>).filter(
		(name) => !checks[name].ok,
	);
	return {
		ok: failing.length === 0,
		checkedAt: new Date(now()).toISOString(),
		failing,
		checks,
	};
}

// ─── Real probes ─────────────────────────────────────────────────────────────

async function pingDatabase(): Promise<void> {
	await db.execute(sql`select 1`);
}

async function pingDocker(): Promise<void> {
	const docker = await getDocker(null);
	await docker.ping();
}

interface JournalFile {
	entries?: Array<{ when?: number; tag?: string }>;
}

/**
 * Directory holding `meta/_journal.json`. The image sets
 * `NIXPLOY_MIGRATIONS_DIR`; in development the panel runs from `apps/web`,
 * so the server package's drizzle folder is two levels up.
 */
export function migrationsDirCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
	const candidates: string[] = [];
	if (env.NIXPLOY_MIGRATIONS_DIR) candidates.push(env.NIXPLOY_MIGRATIONS_DIR);
	candidates.push(
		path.resolve(process.cwd(), "../../packages/server/drizzle"),
		path.resolve(process.cwd(), "packages/server/drizzle"),
		path.resolve(process.cwd(), "drizzle"),
		"/app/packages/server/drizzle",
	);
	return candidates;
}

async function readJournal(): Promise<{ count: number; latestWhen: number } | null> {
	for (const dir of migrationsDirCandidates()) {
		try {
			const raw = await readFile(path.join(dir, "meta", "_journal.json"), "utf8");
			const journal = JSON.parse(raw) as JournalFile;
			const entries = journal.entries ?? [];
			const latestWhen = entries.reduce((max, entry) => Math.max(max, entry.when ?? 0), 0);
			return { count: entries.length, latestWhen };
		} catch {
			// try the next candidate
		}
	}
	return null;
}

/**
 * Compare the migration journal shipped with this build against the rows
 * drizzle's migrator wrote (`created_at` = the journal entry's `when`).
 */
async function readMigrations(): Promise<MigrationInfo> {
	const journal = await readJournal();
	let applied: number | null = null;
	let latestApplied = 0;
	try {
		const rows = (await db.execute(
			sql`select count(*)::int as count, coalesce(max(created_at), 0)::bigint as latest from drizzle.__drizzle_migrations`,
		)) as unknown as Array<{ count: number | string; latest: number | string }>;
		const row = rows[0];
		applied = Number(row?.count ?? 0);
		latestApplied = Number(row?.latest ?? 0);
	} catch (error) {
		// 42P01 = relation does not exist: the migrator never ran against this DB.
		const code = (error as { code?: string }).code;
		if (code !== "42P01") throw error;
		applied = 0;
	}
	if (!journal) {
		return { state: "unknown", applied, expected: null };
	}
	const state: MigrationState =
		latestApplied === journal.latestWhen
			? "current"
			: latestApplied < journal.latestWhen
				? "behind"
				: "ahead";
	return { state, applied, expected: journal.count };
}

/** Rows still `running` after {@link STUCK_DEPLOYMENT_AFTER_MS} (any server). */
async function countStuckDeployments(): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(deployments)
		.where(
			and(
				eq(deployments.status, "running"),
				lt(deployments.createdAt, new Date(Date.now() - STUCK_DEPLOYMENT_AFTER_MS)),
			),
		);
	return Number(row?.count ?? 0);
}

async function readQueue(): Promise<QueueInfo> {
	const local = queueDepth(null);
	const stuck = await countStuckDeployments();
	return { pending: local.pending, running: local.running, stuck };
}

/**
 * Deployments that a panel restart would interrupt: the in-memory queue of
 * this host plus every row still `queued` or `running` (covers jobs on remote
 * servers and rows boot recovery re-enqueues). Used by the self-updater.
 */
export async function countActiveDeployments(): Promise<number> {
	const local = queueDepth(null);
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(deployments)
		.where(inArray(deployments.status, ["running", "queued"]));
	return Math.max(Number(row?.count ?? 0), local.pending + local.running);
}

let traefikProbe: { at: number; present: boolean } | null = null;

/** `docker service ls` filtered on the platform proxy, cached for 10 s. */
async function traefikPresent(): Promise<boolean | null> {
	if (traefikProbe && Date.now() - traefikProbe.at < TRAEFIK_PROBE_CACHE_MS) {
		return traefikProbe.present;
	}
	const stdout = await execAsync(
		"docker service ls --filter name=nixploy-traefik --format '{{.Name}}'",
		{ timeout: CHECK_TIMEOUT_MS },
	);
	const present = stdout
		.split("\n")
		.map((line) => line.trim())
		.includes("nixploy-traefik");
	traefikProbe = { at: Date.now(), present };
	return present;
}

/**
 * Read-only view of the file the platform-alert cron writes. Readiness never
 * re-evaluates the alerts itself: `df`, `docker service ls` and the ACME parse
 * belong to the 5-minute cron, not to a probe Swarm hits every 15 s.
 */
async function readPlatformAlerts(): Promise<PlatformAlertsInfo> {
	const { readPlatformAlertState } = await import("../monitoring/platform-alerts");
	const state = await readPlatformAlertState();
	return {
		evaluatedAt: state.checkedAt > 0 ? new Date(state.checkedAt).toISOString() : null,
		alerts: state.active.map(({ kind, severity, summary }) => ({ kind, severity, summary })),
	};
}

export const realReadinessProbes: ReadinessProbes = {
	pingDatabase,
	pingDocker,
	readMigrations,
	readQueue,
	traefikPresent,
	traefikRequired: () => traefikRequired(),
	readPlatformAlerts,
};

// ─── Cached entry point ──────────────────────────────────────────────────────

let cached: { at: number; report: ReadinessReport } | null = null;
let inFlight: Promise<ReadinessReport> | null = null;

/**
 * Readiness report, shared across callers for {@link READINESS_CACHE_MS}.
 * Concurrent callers await the same pass instead of starting their own.
 */
export async function checkReadiness(
	options: { probes?: ReadinessProbes; force?: boolean } = {},
): Promise<ReadinessReport> {
	const now = Date.now();
	if (!options.force && cached && now - cached.at < READINESS_CACHE_MS) {
		return cached.report;
	}
	if (inFlight) return inFlight;
	inFlight = runReadinessChecks(options.probes ?? realReadinessProbes)
		.then((report) => {
			cached = { at: Date.now(), report };
			return report;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

/** Drop the cached report (tests, and after a self-update roll). */
export function resetReadinessCache(): void {
	cached = null;
	traefikProbe = null;
}

// ─── Version ─────────────────────────────────────────────────────────────────

export interface VersionInfo {
	version: string;
	/** Git SHA baked into the image (`NIXPLOY_GIT_COMMIT`), when known. */
	commit?: string;
	node: string;
}

export function getVersionInfo(env: NodeJS.ProcessEnv = process.env): VersionInfo {
	const commit = env.NIXPLOY_GIT_COMMIT?.trim();
	return {
		version: getAppVersion(),
		...(commit ? { commit } : {}),
		node: process.versions.node,
	};
}
