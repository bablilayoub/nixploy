import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { createLogger } from "../../lib/logger";
import { bestEffort } from "../../utils/best-effort";
import { describeErrorWithCause } from "../../utils/error-cause";
import { execAsync } from "../../utils/exec";
import { getConfigDir, shellQuote } from "../deployment/paths";
import { badRequest, preconditionFailed } from "../errors";
import { readDiskStats } from "../monitoring/host";
import { countActiveDeployments } from "../observability/health";
import { resolveUpdateCandidate } from "./candidate";
import { getAppVersion, NIXPLOY_SERVICE_NAME } from "./check";
import { PREFLIGHT_DISK_BLOCK_BYTES } from "./preflight";
import { assertValidImageRef } from "./registry";
import {
	assertVersionAllowed,
	compareVersions,
	imageVersionTag,
	parseVersion,
	releaseTag,
	withImageTag,
} from "./releases";
import { getUpdateSettings, patchUpdateSettings } from "./settings";

const log = createLogger("updates");

let applyInFlight = false;

/** Consider an update stuck after this long and clear the flag. */
const UPDATE_STUCK_AFTER_MS = 15 * 60 * 1000;

/** Pre-update dumps kept under `<config>/backups` (oldest pruned first). */
export const PRE_UPDATE_BACKUP_KEEP = 3;
const PRE_UPDATE_BACKUP_PREFIX = "pre-update-";
const POSTGRES_SERVICE_LABEL = "com.docker.swarm.service.name=nixploy-postgres";
const WORKER_SERVICE_NAME = "nixploy-worker";

/** A panel cannot coordinate the shutdown of a separate worker while replacing itself. */
async function assertStandaloneUpdate(): Promise<void> {
	let output: string;
	try {
		output = await execAsync("docker service ls --format '{{.Name}}'", { timeout: 15_000 });
	} catch {
		throw preconditionFailed(
			"Cannot verify the platform services. Run the updated host update.sh to inspect and coordinate the update.",
		);
	}
	const services = output
		.split("\n")
		.map((name) => name.trim())
		.filter(Boolean);
	if (
		!services.includes(NIXPLOY_SERVICE_NAME) ||
		services.some((name) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name))
	) {
		throw preconditionFailed(
			"Cannot verify the platform services. Run the updated host update.sh to inspect and coordinate the update.",
		);
	}
	if (services.includes(WORKER_SERVICE_NAME)) {
		throw preconditionFailed(
			"This installation has a separate worker. Run the updated host update.sh so both the panel and worker are drained and upgraded together.",
		);
	}
}

async function assertImageDowngradeSafe(): Promise<void> {
	let upgraded: boolean;
	try {
		const rows = await db.execute<{ upgraded: boolean }>(sql`
			select exists (
				select 1 from information_schema.columns
				where table_schema = 'public' and table_name = 'organization'
				and column_name = 'metadata_v2'
			) as upgraded
		`);
		if (typeof rows[0]?.upgraded !== "boolean") throw new Error("Unknown storage protocol");
		upgraded = rows[0].upgraded;
	} catch {
		throw preconditionFailed(
			"Cannot verify database compatibility. Use the updated host update.sh before attempting a downgrade.",
		);
	}
	if (upgraded) {
		throw preconditionFailed(
			"Image-only downgrades are unavailable after the encrypted organization-variable upgrade. Restore the matching pre-upgrade database, config and encryption keys through the host recovery procedure before starting an older release.",
		);
	}
}

/** Tags and digests can name an old build without looking like a downgrade. */
async function assertImageStorageCompatible(image: string): Promise<void> {
	try {
		const rows = await db.execute<{ upgraded: boolean }>(sql`
			select exists (
				select 1 from information_schema.columns
				where table_schema = 'public' and table_name = 'organization'
				and column_name = 'metadata_v2'
			) as upgraded
		`);
		if (typeof rows[0]?.upgraded !== "boolean") throw new Error("Unknown storage protocol");
		if (!rows[0].upgraded) return;
		const result = await execAsync(
			`docker run --rm --network none --entrypoint sh ${shellQuote(image)} -c 'test -f /app/packages/server/drizzle/0048_noisy_albert_cleary.sql && printf encrypted-org-env-v1'`,
			{ timeout: 30_000 },
		);
		if (result.trim() !== "encrypted-org-env-v1") throw new Error("Incompatible storage protocol");
	} catch {
		throw preconditionFailed(
			"The target image cannot be verified against encrypted organization variables. Use the updated host update.sh; starting an older build requires restoring its matching database, config and keys first.",
		);
	}
}

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
			error: describeErrorWithCause(error),
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
 * Split installations require the host updater to drain both roles. A failed
 * standalone roll pauses for recovery instead of restarting an old image
 * against a schema that may already have changed.
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
	 * migrations (docs/upgrade-notes.md). Does not permit an image-only downgrade
	 * after the encrypted organization-variable storage upgrade.
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

	// Last line of defence: whatever produced this ref (stale settings, a
	// hand-typed image), never roll to an OLDER release without the explicit
	// acknowledgement — migrations are not reversed, so the older build meets
	// a newer schema. `options.version` already went through
	// `assertVersionAllowed`; this catches every other path.
	const targetTag = imageVersionTag(image);
	const target = parseVersion(targetTag);
	if (target && compareVersions(targetTag, getAppVersion()) < 0) {
		isDowngrade = true;
		if (!options?.version && !options?.allowDowngrade) {
			throw badRequest(
				`${releaseTag(targetTag)} is older than the running v${getAppVersion()}. ` +
					"Database migrations are not reversed on downgrade — pass allowDowngrade to proceed anyway.",
			);
		}
	}
	if (isDowngrade) await assertImageDowngradeSafe();
	await assertStandaloneUpdate();

	if (!options?.force) {
		// The pull and the dump both write to the config filesystem; running out
		// half-way leaves a broken image cache and no dump. Same threshold as the
		// preflight the panel shows.
		const disk = await readDiskStats(getConfigDir()).catch(() => null);
		if (disk && disk.totalBytes > 0 && disk.availableBytes < PREFLIGHT_DISK_BLOCK_BYTES) {
			throw preconditionFailed(
				`Only ${(disk.availableBytes / 1024 ** 3).toFixed(1)} GiB free on ${disk.path} — free at least 1 GiB before updating (or force).`,
			);
		}
		const active = await countActiveDeployments().catch((error: unknown) => {
			log.warn("Could not count active deployments before the update", {
				error: describeErrorWithCause(error),
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
	// A long pull must not reuse stale evidence that no separate worker exists.
	try {
		await assertStandaloneUpdate();
		await assertImageStorageCompatible(image);
	} catch (error) {
		applyInFlight = false;
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
				// Migrations may have committed before startup fails. Pause so an
				// older image cannot resume against an incompatible database.
				await execAsync(
					[
						"docker service update",
						"--detach",
						"--force",
						"--no-resolve-image",
						`--image ${shellQuote(image)}`,
						"--update-order stop-first",
						"--update-failure-action pause",
						// Same monitor window as install.sh / update.sh (ROLL_ARGS): a
						// task that passes HEALTHCHECK and dies within 60 s still pauses.
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
			? "Downgrade started — database migrations are not reversed; failed updates pause for manual recovery"
			: backupPath
				? "Update started — database dumped. The dashboard restarts; failed updates pause for manual recovery"
				: "Update started — the dashboard restarts; failed updates pause for manual recovery",
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
