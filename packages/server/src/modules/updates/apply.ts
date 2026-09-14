import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../../lib/logger";
import { bestEffort } from "../../utils/best-effort";
import { execAsync } from "../../utils/exec";
import { getConfigDir, shellQuote } from "../deployment/paths";
import { countActiveDeployments } from "../observability/health";
import { resolveUpdateCandidate } from "./candidate";
import { getAppVersion, NIXPLOY_SERVICE_NAME } from "./check";
import { assertValidImageRef } from "./registry";
import { assertVersionAllowed, releaseTag, withImageTag } from "./releases";
import { getUpdateSettings, patchUpdateSettings } from "./settings";

const log = createLogger("updates");

let applyInFlight = false;

/** Consider an update stuck after this long and clear the flag. */
const UPDATE_STUCK_AFTER_MS = 15 * 60 * 1000;

/** Pre-update dumps kept under `<config>/backups` (oldest pruned first). */
export const PRE_UPDATE_BACKUP_KEEP = 3;
const PRE_UPDATE_BACKUP_PREFIX = "pre-update-";
const POSTGRES_SERVICE_LABEL = "com.docker.swarm.service.name=nixploy-postgres";

export interface ApplyUpdateResult {
	started: boolean;
	image: string;
	message: string;
	/** True when the roll was refused because deployments are in flight (pass `force`). */
	blockedByDeployments?: boolean;
	activeDeployments?: number;
	/** Path of the pre-update database dump, `null` when it was skipped (no postgres container). */
	backupPath?: string | null;
	/** True when the target release is OLDER than the running version. */
	isDowngrade?: boolean;
}

/** Tag of an image ref: `ghcr.io/x/nixploy:v0.2.0@sha256:…` → `v0.2.0` (`""` when untagged). */
export function imageTag(image: string): string {
	const withoutDigest = image.split("@")[0] ?? "";
	const last = withoutDigest.slice(withoutDigest.lastIndexOf("/") + 1);
	const colon = last.indexOf(":");
	return colon === -1 ? "" : last.slice(colon + 1);
}

/** Delete all but the newest `keep` pre-update dumps in `dir` (by mtime). */
export async function prunePreUpdateDumps(
	dir: string,
	keep = PRE_UPDATE_BACKUP_KEEP,
): Promise<string[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const dumps = await Promise.all(
		names
			.filter((name) => name.startsWith(PRE_UPDATE_BACKUP_PREFIX) && name.endsWith(".sql.gz"))
			.map(async (name) => {
				const file = path.join(dir, name);
				const info = await stat(file);
				return { file, mtimeMs: info.mtimeMs };
			}),
	);
	dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const removed: string[] = [];
	for (const dump of dumps.slice(Math.max(0, keep))) {
		await rm(dump.file, { force: true });
		removed.push(dump.file);
	}
	return removed;
}

/**
 * `pg_dump` the platform database through the `nixploy-postgres` container
 * into `<config>/backups/pre-update-<tag>-<timestamp>.sql.gz`, mirroring
 * update.sh: Swarm's rollback restores the previous image, this restores
 * the previous state. Skipped (with a warning) when the container is not on
 * this node — e.g. development against a plain Postgres; any other failure
 * aborts the update. Credentials never leave the postgres container.
 */
export async function preUpdateDatabaseDump(image: string): Promise<string | null> {
	const containerId = (
		await execAsync(`docker ps --filter label=${POSTGRES_SERVICE_LABEL} --format '{{.ID}}'`, {
			timeout: 15_000,
		})
	)
		.split("\n")[0]
		?.trim();
	if (!containerId) {
		log.warn(
			"nixploy-postgres container not found on this node — skipping the pre-update database dump",
		);
		return null;
	}
	const dir = path.join(getConfigDir(), "backups");
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const tag = imageTag(image).replace(/[^A-Za-z0-9._-]/g, "-") || "image";
	const stamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
	const file = path.join(dir, `${PRE_UPDATE_BACKUP_PREFIX}${tag}-${stamp}.sql.gz`);
	try {
		// --clean --if-exists: restores over a non-empty database with one psql.
		await execAsync(
			`set -o pipefail; docker exec ${shellQuote(containerId)} sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > ${shellQuote(file)}`,
			{ timeout: 600_000 },
		);
		const { size } = await stat(file);
		if (size < 200) throw new Error("pg_dump produced an empty dump");
		await chmod(file, 0o600);
	} catch (error) {
		await rm(file, { force: true }).catch(() => {});
		throw new Error(
			`Pre-update database dump failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	log.info(`Pre-update database dump written to ${file}`);
	await prunePreUpdateDumps(dir).catch((error: unknown) => {
		log.warn("Could not prune old pre-update dumps", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
	return file;
}

/**
 * Pull the tracked image, then roll the `nixploy` Swarm service.
 *
 * The service publishes port 3000 in host mode, so the roll MUST be
 * `stop-first`: with start-first the new task can never bind the port while
 * the old one holds it and the update deadlocks (spinner forever).
 *
 * The pull and the pre-update database dump happen synchronously so failures
 * surface to the caller; the actual `docker service update` is delayed a
 * couple of seconds so the HTTP response reaches the browser before this
 * very process is stopped.
 *
 * Refused while deployments are in flight (the restart would interrupt
 * them — see `deployment/recovery.ts`) unless `force` is set; the automatic
 * updater never forces and simply retries on its next tick.
 */
export async function applyUpdate(options?: {
	/** Override the image from settings (rarely needed). */
	image?: string;
	/**
	 * Roll to a specific release instead of whatever the tracked tag points at
	 * (`1.2.3` / `v1.2.3`). Re-tags the settings image, so the registry and
	 * repository stay the ones the instance already trusts.
	 */
	version?: string;
	/**
	 * Acknowledge that rolling to an OLDER release does not reverse database
	 * migrations (docs/upgrade-notes.md). Required for a downgrade.
	 */
	allowDowngrade?: boolean;
	/** Roll even while deployments are running. */
	force?: boolean;
}): Promise<ApplyUpdateResult> {
	if (applyInFlight) {
		return {
			started: false,
			image: options?.image ?? (await getUpdateSettings()).image,
			message: "An update is already in progress",
		};
	}

	const settings = await getUpdateSettings();
	if (settings.updateInProgress) {
		return {
			started: false,
			image: settings.image,
			message: "An update is already in progress",
		};
	}

	// A version pins the TAG of the image the instance already tracks; the
	// registry/repository are never taken from the caller. With neither an
	// image nor a version, roll to what the last check offered (the newest
	// release under the pin) — not to the tag the installer pinned, which
	// would re-pull the version that already runs.
	let requested =
		options?.image?.trim() ||
		resolveUpdateCandidate({
			trackedImage: settings.image,
			latestReleaseTag: settings.releaseTag ?? null,
			pinnedVersion: settings.pinnedVersion,
		}).image;
	let isDowngrade = false;
	if (options?.version) {
		({ isDowngrade } = assertVersionAllowed({
			currentVersion: getAppVersion(),
			targetVersion: options.version,
			allowDowngrade: options.allowDowngrade,
			pinnedVersion: settings.pinnedVersion,
		}));
		requested = withImageTag(settings.image, releaseTag(options.version));
	}
	// Validate before anything touches a shell: the ref is stored settings /
	// caller input, and `exec` runs through `sh -c`.
	const image = assertValidImageRef(requested).canonical;

	if (!options?.force) {
		const active = await countActiveDeployments().catch((error: unknown) => {
			log.warn("Could not count active deployments before the update", {
				error: error instanceof Error ? error.message : String(error),
			});
			return 0;
		});
		if (active > 0) {
			return {
				started: false,
				image,
				message: `${active} deployment(s) are running — wait for them to finish or force the update`,
				blockedByDeployments: true,
				activeDeployments: active,
			};
		}
	}
	applyInFlight = true;

	try {
		await execAsync(`docker pull ${shellQuote(image)}`, { timeout: 600_000 });
	} catch (error) {
		applyInFlight = false;
		const message = error instanceof Error ? error.message : String(error);
		await patchUpdateSettings({ lastError: `Image pull failed: ${message}` });
		throw error;
	}

	let backupPath: string | null = null;
	try {
		backupPath = await preUpdateDatabaseDump(image);
	} catch (error) {
		applyInFlight = false;
		const message = error instanceof Error ? error.message : String(error);
		await patchUpdateSettings({ lastError: message });
		throw error;
	}

	// `lastUpdateAt` doubles as "when this attempt started" for stuck detection.
	await patchUpdateSettings({
		updateInProgress: true,
		updateAvailable: false,
		lastUpdateAt: new Date().toISOString(),
		lastError: null,
	});

	// Roll after the response has been flushed to the client. stop-first stops
	// this container almost immediately, so nothing may run after this point.
	setTimeout(() => {
		void (async () => {
			try {
				// A task that fails to start (bad migration, boot crash) rolls the
				// service back to the previous spec instead of crash-looping with
				// the panel down. Rollback must be stop-first for the same
				// host-mode port reason as the update itself.
				await execAsync(
					[
						"docker service update",
						"--detach",
						"--force",
						"--no-resolve-image",
						`--image ${shellQuote(image)}`,
						"--update-order stop-first",
						"--update-failure-action rollback",
						// Same monitor window as install.sh / update.sh (ROLL_ARGS): a
						// task that passes HEALTHCHECK and dies within 60 s still rolls back.
						"--update-monitor 60s",
						// Panels installed before the graceful-shutdown work keep Swarm's
						// 10 s default until update.sh runs; set it here too so an in-app
						// update gives running deploys the same drain window.
						"--stop-grace-period 90s",
						"--rollback-order stop-first",
						NIXPLOY_SERVICE_NAME,
					].join(" "),
					{ timeout: 120_000 },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error("Self-update roll failed:", message);
				await bestEffort("record service update failure", () =>
					patchUpdateSettings({
						updateInProgress: false,
						lastError: `Service update failed: ${message}`,
					}),
				);
			} finally {
				applyInFlight = false;
			}
		})();
	}, 2_000);

	return {
		started: true,
		image,
		message: isDowngrade
			? "Downgrade started — database migrations are NOT reversed; restore the pre-update dump if the older version cannot read the schema"
			: backupPath
				? "Update started — database dumped, the dashboard restarts in a few seconds"
				: "Update started — the dashboard restarts in a few seconds",
		backupPath,
		isDowngrade,
	};
}

/** Clear the in-progress flag after the new container has booted. */
export async function clearStaleUpdateFlag(): Promise<void> {
	const settings = await getUpdateSettings();
	if (!settings.updateInProgress) return;
	await patchUpdateSettings({ updateInProgress: false });
}

/**
 * Safety net for rolls that never converged (e.g. the old start-first
 * deadlock, or docker failing after the flag was set): if the flag has been
 * up longer than {@link UPDATE_STUCK_AFTER_MS}, clear it and surface an
 * error so the UI un-sticks.
 */
export async function resolveStuckUpdate(): Promise<void> {
	const settings = await getUpdateSettings();
	if (!settings.updateInProgress) return;
	const startedAt = settings.lastUpdateAt ? Date.parse(settings.lastUpdateAt) : Number.NaN;
	if (Number.isFinite(startedAt) && Date.now() - startedAt < UPDATE_STUCK_AFTER_MS) return;
	await patchUpdateSettings({
		updateInProgress: false,
		lastError:
			"The previous update did not complete — check `docker service ps nixploy` on the server",
	});
}
