import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, min } from "drizzle-orm";
import schedule from "node-schedule";
import { db } from "../../db";
import { backupRuns, deployments, notifications } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { dockerCleanup } from "../deployment/cleanup";
import { getDocker } from "../deployment/docker";
import { getConfigDir } from "../deployment/paths";
import { emitDockerCleanupNotification } from "../notifications";
import {
	emitPlatformAlert,
	type PlatformAlert,
	type PlatformAlertKind,
	type PlatformAlertSeverity,
} from "../notifications/platform";

// Re-exported so a consumer of the alert pass never has to reach into the
// notifications module for the shape it just received.
export type { PlatformAlert, PlatformAlertKind, PlatformAlertSeverity };

import { getTraefikDir } from "../traefik/paths";
import { readDiskStats } from "./host";

const log = createLogger("platform-alerts");

/**
 * Platform self-alerts (ops audit #10/#30).
 *
 * Every 5 minutes the panel checks the things an operator only ever learns
 * about from a failed deploy or an angry user:
 *
 * | kind              | warning                    | critical                |
 * | ----------------- | -------------------------- | ----------------------- |
 * | `hostDisk`        | config-dir filesystem > 85% | > 95%                   |
 * | `queueStalled`    | oldest `queued` job > 30 m  | —                       |
 * | `certExpiry`      | an ACME cert < 14 d left    | expired                 |
 * | `platformService` | —                          | traefik/postgres not at desired replicas |
 * | `instanceBackup`  | no successful instance backup in N days | —          |
 *
 * Every evaluator is a pure function over already-fetched inputs so the
 * matrix is unit-testable without Docker, a database or a filesystem.
 *
 * Alerts fan out through the `platformAlert` dispatch helper
 * (`modules/notifications/platform.ts`) to instance-admin channels only, and
 * each `kind:severity` has a 24 h cooldown persisted in
 * `<config>/platform-alerts.json` so a restart does not re-fire everything.
 * The same file is the source the readiness endpoint and the Monitoring page
 * read — evaluation happens once, in the cron.
 */

export const PLATFORM_ALERT_CRON = "*/5 * * * *";
/** Per `kind:severity` re-notify interval. */
export const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const DISK_WARNING_PERCENT = 85;
export const DISK_CRITICAL_PERCENT = 95;
/** A job still `queued` after this long means the worker is not draining. */
export const QUEUE_STALL_MS = 30 * 60 * 1000;
/** Certificates inside this window are reported. */
export const CERT_EXPIRY_WARNING_DAYS = 14;
/** Default for `NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS` (`0` disables the check). */
export const DEFAULT_INSTANCE_BACKUP_ALERT_DAYS = 8;
/** Swarm services the platform cannot work without. */
export const PLATFORM_SERVICES = ["nixploy-traefik", "nixploy-postgres"] as const;

// ── persisted state ──────────────────────────────────────────────────────────

export interface PlatformAlertState {
	/** Epoch ms of the last completed evaluation, or 0 when none ran yet. */
	checkedAt: number;
	/** Alerts that were still firing at `checkedAt`. */
	active: Array<{ kind: PlatformAlertKind; severity: PlatformAlertSeverity; summary: string }>;
	/** `kind:severity` → epoch ms of the last notification. */
	cooldowns: Record<string, number>;
}

export const EMPTY_STATE: PlatformAlertState = { checkedAt: 0, active: [], cooldowns: {} };

/** `<config>/platform-alerts.json` — cooldowns survive a panel restart. */
export const platformAlertStatePath = (): string =>
	path.join(getConfigDir(), "platform-alerts.json");

/** Tolerant reader: a missing or corrupt file is "nothing known yet". */
export async function readPlatformAlertState(): Promise<PlatformAlertState> {
	try {
		const raw = await readFile(platformAlertStatePath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<PlatformAlertState>;
		return {
			checkedAt: typeof parsed.checkedAt === "number" ? parsed.checkedAt : 0,
			active: Array.isArray(parsed.active) ? parsed.active : [],
			cooldowns: parsed.cooldowns && typeof parsed.cooldowns === "object" ? parsed.cooldowns : {},
		};
	} catch {
		return { ...EMPTY_STATE, active: [], cooldowns: {} };
	}
}

/** Atomic write (tmp + rename) so a crash mid-write cannot corrupt the file. */
export async function writePlatformAlertState(state: PlatformAlertState): Promise<void> {
	const target = platformAlertStatePath();
	const tmp = `${target}.tmp`;
	await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
	await rename(tmp, target);
}

// ── evaluators (pure) ────────────────────────────────────────────────────────

const pct = (value: number): string => `${value.toFixed(1)}%`;
const gib = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

/** Disk pressure on the filesystem holding the config dir. */
export function evaluateDiskAlert(disk: {
	usedPercent: number | null;
	usedBytes: number;
	totalBytes: number;
	availableBytes: number;
	path: string;
}): PlatformAlert | null {
	if (disk.usedPercent == null) return null;
	if (disk.usedPercent < DISK_WARNING_PERCENT) return null;
	const critical = disk.usedPercent >= DISK_CRITICAL_PERCENT;
	return {
		kind: "hostDisk",
		severity: critical ? "critical" : "warning",
		summary: `Disk usage on ${disk.path} is ${pct(disk.usedPercent)} (${gib(disk.availableBytes)} free of ${gib(disk.totalBytes)}). Builds, backups and logs fail when it fills.`,
		fields: [
			{ name: "Used", value: pct(disk.usedPercent) },
			{ name: "Free", value: gib(disk.availableBytes) },
			{ name: "Total", value: gib(disk.totalBytes) },
		],
	};
}

/** Oldest job still `queued` — the worker is wedged or the concurrency is 0. */
export function evaluateQueueAlert(
	oldestQueuedAt: Date | number | null,
	now: number,
): PlatformAlert | null {
	if (oldestQueuedAt == null) return null;
	const at = oldestQueuedAt instanceof Date ? oldestQueuedAt.getTime() : oldestQueuedAt;
	if (!Number.isFinite(at)) return null;
	const ageMs = now - at;
	if (ageMs < QUEUE_STALL_MS) return null;
	const minutes = Math.round(ageMs / 60_000);
	return {
		kind: "queueStalled",
		severity: "warning",
		summary: `The oldest queued deployment has been waiting ${minutes} minutes. The deploy worker may be stuck.`,
		fields: [{ name: "Oldest queued", value: `${minutes} min` }],
	};
}

export interface AcmeCertificateEntry {
	domain: string;
	/** Epoch ms, or `null` when the certificate could not be parsed. */
	notAfter: number | null;
}

/** Certificates at or past {@link CERT_EXPIRY_WARNING_DAYS}. */
export function evaluateCertificateAlert(
	certificates: AcmeCertificateEntry[],
	now: number,
): PlatformAlert | null {
	const windowMs = CERT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
	const expiring = certificates
		.filter(
			(entry): entry is AcmeCertificateEntry & { notAfter: number } =>
				entry.notAfter != null && entry.notAfter - now < windowMs,
		)
		.sort((a, b) => a.notAfter - b.notAfter);
	if (expiring.length === 0) return null;
	const soonest = expiring[0];
	if (!soonest) return null;
	const days = Math.floor((soonest.notAfter - now) / (24 * 60 * 60 * 1000));
	const expired = soonest.notAfter <= now;
	const rest = expiring.length > 1 ? ` (+${expiring.length - 1} more)` : "";
	return {
		kind: "certExpiry",
		severity: expired ? "critical" : "warning",
		summary: expired
			? `The certificate for ${soonest.domain} has expired${rest}. Traefik is serving the self-signed fallback; check the ACME email and DNS.`
			: `The certificate for ${soonest.domain} expires in ${days} day${days === 1 ? "" : "s"}${rest}. Renewal normally happens 30 days out — check Traefik's logs.`,
		fields: [
			{ name: "Domain", value: soonest.domain },
			{ name: "Expires", value: new Date(soonest.notAfter).toISOString() },
			{ name: "Certificates affected", value: String(expiring.length) },
		],
	};
}

export interface PlatformServiceState {
	name: string;
	running: number;
	desired: number;
}

/** `nixploy-traefik` / `nixploy-postgres` not at their desired replica count. */
export function evaluatePlatformServiceAlert(
	services: PlatformServiceState[],
): PlatformAlert | null {
	const degraded = services.filter((service) => service.running < service.desired);
	if (degraded.length === 0) return null;
	const detail = degraded.map((s) => `${s.name} ${s.running}/${s.desired}`).join(", ");
	return {
		kind: "platformService",
		severity: "critical",
		summary: `Platform service not at its desired replica count: ${detail}. Check \`docker service ps\`.`,
		fields: degraded.map((s) => ({ name: s.name, value: `${s.running}/${s.desired}` })),
	};
}

/** `NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS`; `0` (or a bad value) disables the check. */
export function resolveInstanceBackupAlertDays(
	raw = process.env.NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS,
): number {
	if (raw == null || raw.trim() === "") return DEFAULT_INSTANCE_BACKUP_ALERT_DAYS;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_INSTANCE_BACKUP_ALERT_DAYS;
	return parsed;
}

/**
 * No successful instance backup within the window. `lastSuccessAt == null`
 * means one was never taken — that is worth saying once, since the whole
 * point of the alert is to catch an install that never configured one.
 */
export function evaluateInstanceBackupAlert(
	lastSuccessAt: Date | number | null,
	now: number,
	days = DEFAULT_INSTANCE_BACKUP_ALERT_DAYS,
): PlatformAlert | null {
	if (days <= 0) return null;
	const windowMs = days * 24 * 60 * 60 * 1000;
	if (lastSuccessAt == null) {
		return {
			kind: "instanceBackup",
			severity: "warning",
			summary: `No instance backup has ever completed. Configure one under Settings → Backup storage so the panel database and config can be restored (docs/instance-backup.md).`,
			fields: [{ name: "Last successful backup", value: "never" }],
		};
	}
	const at = lastSuccessAt instanceof Date ? lastSuccessAt.getTime() : lastSuccessAt;
	if (!Number.isFinite(at) || now - at < windowMs) return null;
	const ageDays = Math.floor((now - at) / (24 * 60 * 60 * 1000));
	return {
		kind: "instanceBackup",
		severity: "warning",
		summary: `The last successful instance backup was ${ageDays} days ago (threshold ${days}). Check Settings → Backup storage and the destination credentials.`,
		fields: [
			{ name: "Last successful backup", value: new Date(at).toISOString() },
			{ name: "Age", value: `${ageDays} days` },
		],
	};
}

/**
 * Split the evaluated alerts into the ones to notify about and the updated
 * cooldown map. The key is `kind:severity`, so an escalation from warning to
 * critical notifies immediately instead of waiting out the warning's cooldown.
 */
export function selectAlertsToSend(
	alerts: PlatformAlert[],
	cooldowns: Record<string, number>,
	now: number,
	cooldownMs = ALERT_COOLDOWN_MS,
): { send: PlatformAlert[]; cooldowns: Record<string, number> } {
	const next: Record<string, number> = {};
	const send: PlatformAlert[] = [];
	const activeKeys = new Set(alerts.map((alert) => `${alert.kind}:${alert.severity}`));
	// Keep only cooldowns of alerts that are still firing: a resolved alert
	// must be able to notify again straight away when it comes back.
	for (const [key, at] of Object.entries(cooldowns)) {
		if (activeKeys.has(key) && typeof at === "number") next[key] = at;
	}
	for (const alert of alerts) {
		const key = `${alert.kind}:${alert.severity}`;
		const last = next[key];
		if (last != null && now - last < cooldownMs) continue;
		send.push(alert);
		next[key] = now;
	}
	return { send, cooldowns: next };
}

// ── real inputs ──────────────────────────────────────────────────────────────

/**
 * `certificate` entries of an `acme.json` file, base64-decoded to PEM. The
 * file is written by Traefik: `{ "<resolver>": { "Certificates": [ { "domain":
 * { "main": "…" }, "certificate": "<base64 PEM chain>" } ] } }`. An empty or
 * unreadable file yields no entries (a fresh install touches a zero-byte one).
 */
export function extractAcmeCertificates(raw: string): Array<{ domain: string; pem: string }> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null) return [];
	const out: Array<{ domain: string; pem: string }> = [];
	for (const resolver of Object.values(parsed as Record<string, unknown>)) {
		const certificates = (resolver as { Certificates?: unknown })?.Certificates;
		if (!Array.isArray(certificates)) continue;
		for (const entry of certificates) {
			const record = entry as {
				domain?: { main?: unknown };
				certificate?: unknown;
			};
			const domain = typeof record.domain?.main === "string" ? record.domain.main : "";
			if (!domain || typeof record.certificate !== "string") continue;
			let pem: string;
			try {
				pem = Buffer.from(record.certificate, "base64").toString("utf8");
			} catch {
				continue;
			}
			if (!pem.includes("BEGIN CERTIFICATE")) continue;
			out.push({ domain, pem });
		}
	}
	return out;
}

/** `notAfter` of the leaf certificate in a PEM chain, or null when unparseable. */
export async function certificateNotAfter(pem: string): Promise<number | null> {
	try {
		const { X509Certificate } = await import("node:crypto");
		const leaf = pem.slice(0, pem.indexOf("-----END CERTIFICATE-----") + 25);
		const parsed = new X509Certificate(leaf);
		const at = Date.parse(parsed.validTo);
		return Number.isFinite(at) ? at : null;
	} catch {
		return null;
	}
}

/** Certificates with expiry, from `<config>/traefik/acme.json`. */
export async function readAcmeCertificates(): Promise<AcmeCertificateEntry[]> {
	let raw: string;
	try {
		raw = await readFile(path.join(getTraefikDir(), "acme.json"), "utf8");
	} catch {
		return []; // No acme.json (dev, or a proxy managed elsewhere) — skip.
	}
	const entries = extractAcmeCertificates(raw);
	return Promise.all(
		entries.map(async (entry) => ({
			domain: entry.domain,
			notAfter: await certificateNotAfter(entry.pem),
		})),
	);
}

/** Replica counts of the platform services, via dockerode. */
export async function readPlatformServices(): Promise<PlatformServiceState[]> {
	const docker = await getDocker(null);
	const [services, tasks] = await Promise.all([
		docker.listServices({ filters: { name: [...PLATFORM_SERVICES] } }),
		docker.listTasks({ filters: { "desired-state": ["running"] } }),
	]);
	const out: PlatformServiceState[] = [];
	for (const name of PLATFORM_SERVICES) {
		const service = services.find((entry) => entry.Spec?.Name === name);
		if (!service) continue; // Not installed on this host (dev) — not an alert.
		const running = tasks.filter(
			(task) =>
				(task as { ServiceID?: string }).ServiceID === service.ID &&
				(task as { Status?: { State?: string } }).Status?.State === "running",
		).length;
		const replicated = (service.Spec as { Mode?: { Replicated?: { Replicas?: number } } })?.Mode
			?.Replicated?.Replicas;
		// A global service has one task per node; on the single node install.sh
		// creates that is 1.
		const desired = typeof replicated === "number" ? replicated : 1;
		out.push({ name, running, desired });
	}
	return out;
}

/** `min(created_at)` over deployments still in the `queued` state. */
export async function readOldestQueuedDeployment(): Promise<Date | null> {
	const [row] = await db
		.select({ oldest: min(deployments.createdAt) })
		.from(deployments)
		.where(eq(deployments.status, "queued"));
	return row?.oldest ? new Date(row.oldest) : null;
}

/** Most recent `backup_run` with `kind = 'instance'` and `status = 'success'`. */
export async function readLastInstanceBackup(): Promise<Date | null> {
	const [row] = await db
		.select({ startedAt: backupRuns.startedAt })
		.from(backupRuns)
		.where(and(eq(backupRuns.kind, "instance"), eq(backupRuns.status, "success")))
		.orderBy(desc(backupRuns.startedAt))
		.limit(1);
	return row?.startedAt ?? null;
}

// ── the pass ─────────────────────────────────────────────────────────────────

export interface PlatformAlertInputs {
	disk: Awaited<ReturnType<typeof readDiskStats>>;
	oldestQueuedAt: Date | null;
	certificates: AcmeCertificateEntry[];
	services: PlatformServiceState[];
	lastInstanceBackupAt: Date | null;
	backupAlertDays: number;
}

/** Fold every evaluator over already-gathered inputs. Pure. */
export function evaluatePlatformAlerts(inputs: PlatformAlertInputs, now: number): PlatformAlert[] {
	return [
		evaluateDiskAlert(inputs.disk),
		evaluateQueueAlert(inputs.oldestQueuedAt, now),
		evaluateCertificateAlert(inputs.certificates, now),
		evaluatePlatformServiceAlert(inputs.services),
		evaluateInstanceBackupAlert(inputs.lastInstanceBackupAt, now, inputs.backupAlertDays),
	].filter((alert): alert is PlatformAlert => alert !== null);
}

/** Whether the Swarm replica probe applies (install.sh owns the services). */
const platformServicesProbed = (env: NodeJS.ProcessEnv = process.env): boolean =>
	env.NIXPLOY_DISABLE_TRAEFIK_BOOT !== "1";

const soften = async <T>(label: string, probe: () => Promise<T>, fallback: T): Promise<T> => {
	try {
		return await probe();
	} catch (error) {
		log.warn(`${label} probe failed`, {
			error: error instanceof Error ? error.message : String(error),
		});
		return fallback;
	}
};

/** Gather every input; a single failing probe never aborts the pass. */
export async function collectPlatformAlertInputs(): Promise<PlatformAlertInputs> {
	const [disk, oldestQueuedAt, certificates, services, lastInstanceBackupAt] = await Promise.all([
		soften("disk", () => readDiskStats(), {
			totalBytes: 0,
			usedBytes: 0,
			availableBytes: 0,
			usedPercent: null,
			path: getConfigDir(),
		}),
		soften("queue", () => readOldestQueuedDeployment(), null),
		soften("acme", () => readAcmeCertificates(), []),
		platformServicesProbed()
			? soften("services", () => readPlatformServices(), [])
			: Promise.resolve<PlatformServiceState[]>([]),
		soften("instance-backup", () => readLastInstanceBackup(), null),
	]);
	return {
		disk,
		oldestQueuedAt,
		certificates,
		services,
		lastInstanceBackupAt,
		backupAlertDays: resolveInstanceBackupAlertDays(),
	};
}

/**
 * One evaluation pass: gather inputs, evaluate, notify what is off cooldown,
 * persist the state the readiness endpoint and the Monitoring page read.
 */
export async function runPlatformAlertPass(now = Date.now()): Promise<PlatformAlert[]> {
	const inputs = await collectPlatformAlertInputs();
	const alerts = evaluatePlatformAlerts(inputs, now);
	const previous = await readPlatformAlertState();
	const { send, cooldowns } = selectAlertsToSend(alerts, previous.cooldowns, now);
	for (const alert of send) {
		log[alert.severity === "critical" ? "error" : "warn"](alert.summary, { alert: alert.kind });
		await emitPlatformAlert(alert);
	}
	await writePlatformAlertState({
		checkedAt: now,
		active: alerts.map(({ kind, severity, summary }) => ({ kind, severity, summary })),
		cooldowns,
	});
	return alerts;
}

// ── opt-in weekly docker cleanup ─────────────────────────────────────────────

/**
 * `NIXPLOY_DOCKER_CLEANUP_CRON` — off by default. When set to a cron
 * expression (e.g. `0 4 * * 0` for Sunday 04:00 **in the process timezone**,
 * which is UTC in the shipped image) the panel prunes dangling images and the
 * BuildKit cache on the Nixploy host and emits the existing `dockerCleanup`
 * notification. Tagged images are never touched (see `deployment/cleanup.ts`).
 */
export function resolveDockerCleanupCron(
	raw = process.env.NIXPLOY_DOCKER_CLEANUP_CRON,
): string | null {
	const value = raw?.trim();
	if (!value || value === "0" || value.toLowerCase() === "off") return null;
	return value;
}

/** Prune + notify every organization that subscribed to `dockerCleanup`. */
export async function runDockerCleanupPass(): Promise<void> {
	await dockerCleanup(null);
	const orgs = await db
		.selectDistinct({ organizationId: notifications.organizationId })
		.from(notifications)
		.where(eq(notifications.dockerCleanup, true));
	for (const { organizationId } of orgs) {
		await emitDockerCleanupNotification(organizationId, {
			scope: "build-cache",
			serverId: null,
			actor: "platform cron",
		});
	}
}

// ── cron registration ────────────────────────────────────────────────────────

let started = false;
let inFlight = false;

/**
 * Register the platform-alert cron (every 5 minutes) and, when
 * `NIXPLOY_DOCKER_CLEANUP_CRON` is set, the opt-in Docker cleanup cron.
 * Called once from `apps/web/server.ts` next to the other cron initializers.
 */
export function startPlatformAlerts(): void {
	if (started) return; // tsx watch / HMR re-invocations must not double-register
	started = true;

	schedule.scheduleJob("platform-alerts", PLATFORM_ALERT_CRON, async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			await runPlatformAlertPass();
		} catch (error) {
			log.error("Platform alert pass failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			inFlight = false;
		}
	});

	const cleanupCron = resolveDockerCleanupCron();
	if (!cleanupCron) return;
	schedule.scheduleJob("platform-docker-cleanup", cleanupCron, async () => {
		try {
			await runDockerCleanupPass();
			log.info("Docker cleanup cron finished");
		} catch (error) {
			log.error("Docker cleanup cron failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
	log.info("Docker cleanup cron registered", { cron: cleanupCron });
}
