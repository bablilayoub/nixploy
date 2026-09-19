import { getConfigDir } from "../application/paths";
import { type HostDiskStats, readDiskStats } from "../monitoring/host";
import { readLastInstanceBackup } from "../monitoring/platform-alerts";
import {
	checkReadiness,
	countActiveDeployments,
	type ReadinessReport,
} from "../observability/health";
import { resolveUpdateCandidate } from "./candidate";
import { getAppVersion, getRunningDigest, getRunningImageRef, resolveTargetRelease } from "./check";
import { assertValidImageRef, fetchRemoteDigest } from "./registry";
import {
	compareVersions,
	imageVersionTag,
	parseVersion,
	type ReleaseInfo,
	releaseTag,
	withImageTag,
} from "./releases";
import { getUpdateSettings } from "./settings";

/**
 * What an operator should know BEFORE pressing Update: the checks the
 * updater enforces (in-progress, downgrade, running deployments) plus the
 * ones it cannot recover from once the roll has started — disk for the pull
 * and the dump, a target the registry cannot resolve, a platform that is
 * already unhealthy, a release whose notes warn of a breaking change.
 *
 * `evaluatePreflight` is pure; `runUpdatePreflight` collects the inputs.
 * A `block` disables the button in the panel and is refused by
 * `applyUpdate` where it can (disk); a `warn` is shown and left to the
 * operator.
 */

export type PreflightLevel = "ok" | "warn" | "block";

export interface PreflightCheck {
	id: string;
	level: PreflightLevel;
	title: string;
	detail: string;
	url?: string | null;
}

export interface PreflightInputs {
	currentVersion: string;
	targetTag: string | null;
	isDowngrade: boolean;
	allowDowngrade: boolean;
	updateInProgress: boolean;
	disk: HostDiskStats | null;
	activeDeployments: number | null;
	lastInstanceBackupAt: Date | null;
	currentDigest: string | null;
	remoteDigest: string | null;
	registryError: string | null;
	release: ReleaseInfo | null;
	readiness: ReadinessReport | null;
}

export interface UpdatePreflight {
	image: string;
	currentVersion: string;
	targetVersion: string | null;
	checks: PreflightCheck[];
	/** No blocking check. */
	ok: boolean;
	blocks: number;
	warnings: number;
	checkedAt: string;
}

const GIB = 1024 * 1024 * 1024;
/** Below this the pull or the pre-update dump is likely to fail mid-way. */
export const PREFLIGHT_DISK_BLOCK_BYTES = 1 * GIB;
export const PREFLIGHT_DISK_WARN_BYTES = 3 * GIB;
export const PREFLIGHT_BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NOTES_WARNING_RE =
	/breaking|regression|manual step|migration note|before upgrading|action required/i;

const formatGib = (bytes: number): string => `${(bytes / GIB).toFixed(1)} GiB`;

export function evaluatePreflight(inputs: PreflightInputs, now = Date.now()): PreflightCheck[] {
	const checks: PreflightCheck[] = [];

	checks.push(
		inputs.updateInProgress
			? {
					id: "in-progress",
					level: "block",
					title: "An update is already in progress",
					detail:
						"Wait for it to finish (or for the stuck-update guard to clear it) before starting another.",
				}
			: { id: "in-progress", level: "ok", title: "No update in progress", detail: "" },
	);

	if (inputs.isDowngrade) {
		checks.push({
			id: "downgrade",
			level: inputs.allowDowngrade ? "warn" : "block",
			title: `${inputs.targetTag ?? "The target"} is older than the running v${inputs.currentVersion}`,
			detail:
				"Database migrations are never reversed: the older build meets a newer schema. Restore the pre-update dump if it cannot read it.",
		});
	}

	if (inputs.registryError || !inputs.remoteDigest) {
		checks.push({
			id: "registry",
			level: "block",
			title: "The target image cannot be resolved",
			detail: inputs.registryError
				? `The registry answered: ${inputs.registryError}`
				: "The registry returned no digest for this tag — a typo in the pin, or a release that was never published.",
		});
	} else if (inputs.currentDigest && inputs.currentDigest === inputs.remoteDigest) {
		checks.push({
			id: "registry",
			level: "warn",
			title: "Already running this image",
			detail:
				"The tag resolves to the digest that is running; the update would restart the panel for nothing.",
		});
	} else {
		checks.push({
			id: "registry",
			level: "ok",
			title: "Target image resolves",
			detail: `Digest ${inputs.remoteDigest.slice(0, 19)}…`,
		});
	}

	if (inputs.disk && inputs.disk.totalBytes > 0) {
		const free = inputs.disk.availableBytes;
		checks.push(
			free < PREFLIGHT_DISK_BLOCK_BYTES
				? {
						id: "disk",
						level: "block",
						title: `${formatGib(free)} free on ${inputs.disk.path}`,
						detail:
							"The image pull and the pre-update database dump need room; free at least 1 GiB (docker system prune, old backups) first.",
					}
				: free < PREFLIGHT_DISK_WARN_BYTES || (inputs.disk.usedPercent ?? 0) >= 85
					? {
							id: "disk",
							level: "warn",
							title: `${formatGib(free)} free on ${inputs.disk.path}`,
							detail: "Enough for this update, but the host is filling up.",
						}
					: {
							id: "disk",
							level: "ok",
							title: `${formatGib(free)} free on ${inputs.disk.path}`,
							detail: "",
						},
		);
	} else {
		checks.push({
			id: "disk",
			level: "warn",
			title: "Disk space unknown",
			detail: "The config directory's filesystem could not be measured.",
		});
	}

	if (inputs.activeDeployments === null) {
		checks.push({
			id: "deployments",
			level: "warn",
			title: "Could not count running deployments",
			detail: "",
		});
	} else if (inputs.activeDeployments > 0) {
		checks.push({
			id: "deployments",
			level: "warn",
			title: `${inputs.activeDeployments} deployment${inputs.activeDeployments === 1 ? "" : "s"} running`,
			detail:
				"The restart interrupts them. The updater asks before rolling anyway; automatic updates wait.",
		});
	} else {
		checks.push({ id: "deployments", level: "ok", title: "No deployment running", detail: "" });
	}

	if (!inputs.lastInstanceBackupAt) {
		checks.push({
			id: "backup",
			level: "warn",
			title: "No instance backup has ever succeeded",
			detail:
				"The updater dumps the platform database itself, but not your volumes or config. Settings → Backup storage → Instance backup.",
		});
	} else if (now - inputs.lastInstanceBackupAt.getTime() > PREFLIGHT_BACKUP_MAX_AGE_MS) {
		const days = Math.floor((now - inputs.lastInstanceBackupAt.getTime()) / (24 * 60 * 60 * 1000));
		checks.push({
			id: "backup",
			level: "warn",
			title: `Last instance backup ${days} day${days === 1 ? "" : "s"} ago`,
			detail: "Consider a fresh one; the pre-update dump covers the database only.",
		});
	} else {
		checks.push({ id: "backup", level: "ok", title: "Recent instance backup", detail: "" });
	}

	const readiness = inputs.readiness;
	if (!readiness) {
		checks.push({
			id: "health",
			level: "warn",
			title: "Platform health unknown",
			detail: "The readiness probes did not answer.",
		});
	} else {
		const hard = ["database", "docker"].filter((name) => readiness.failing.includes(name));
		const soft = readiness.failing.filter((name) => !hard.includes(name));
		if (hard.length > 0) {
			checks.push({
				id: "health",
				level: "block",
				title: `Platform unhealthy: ${hard.join(", ")}`,
				detail:
					"An update cannot repair a database or Docker the panel cannot reach; fix that first.",
			});
		} else if (soft.length > 0) {
			checks.push({
				id: "health",
				level: "warn",
				title: `Readiness warnings: ${soft.join(", ")}`,
				detail:
					readiness.checks.migrations.state !== "current"
						? `Migrations are ${readiness.checks.migrations.state} — finish the running version's migrations before rolling to another.`
						: "See /api/ready for details.",
			});
		} else {
			checks.push({ id: "health", level: "ok", title: "Platform healthy", detail: "" });
		}
	}

	if (inputs.release) {
		const flagged = inputs.release.notes ? NOTES_WARNING_RE.test(inputs.release.notes) : false;
		checks.push({
			id: "release",
			level: flagged ? "warn" : "ok",
			title: flagged
				? `${inputs.release.tag} notes mention a breaking change or manual step`
				: `Release notes for ${inputs.release.tag} found`,
			detail: flagged ? "Read them before updating." : "",
			url: inputs.release.url,
		});
	} else {
		checks.push({
			id: "release",
			level: "warn",
			title: "No release notes found for the target",
			detail: "A moving tag, a release that was never published, or GitHub unreachable.",
		});
	}

	return checks;
}

/** Collect every input and evaluate. Never throws for a probe that fails — that is a warning. */
export async function runUpdatePreflight(options?: {
	version?: string;
	allowDowngrade?: boolean;
}): Promise<UpdatePreflight> {
	const settings = await getUpdateSettings();
	const currentVersion = getAppVersion();
	const requested = options?.version
		? withImageTag(settings.image, releaseTag(options.version))
		: resolveUpdateCandidate({
				trackedImage: settings.image,
				latestReleaseTag: settings.releaseTag ?? null,
				pinnedVersion: settings.pinnedVersion,
			}).image;
	const image = assertValidImageRef(requested).canonical;
	const targetTag = imageVersionTag(image);
	const targetVersion = targetTag && parseVersion(targetTag) ? targetTag : null;
	const isDowngrade = targetVersion ? compareVersions(targetVersion, currentVersion) < 0 : false;

	const [disk, activeDeployments, lastInstanceBackupAt, running, remote, release, readiness] =
		await Promise.all([
			readDiskStats(getConfigDir()).catch(() => null),
			countActiveDeployments().catch(() => null),
			readLastInstanceBackup().catch(() => null),
			getRunningImageRef()
				.then((ref) => getRunningDigest(ref))
				.catch(() => null),
			fetchRemoteDigest(image)
				.then((digest) => ({ digest, error: null as string | null }))
				.catch((error: unknown) => ({
					digest: null,
					error: error instanceof Error ? error.message : String(error),
				})),
			resolveTargetRelease(image).catch(() => null),
			checkReadiness().catch(() => null),
		]);

	const checks = evaluatePreflight({
		currentVersion,
		targetTag: targetVersion ? releaseTag(targetVersion) : null,
		isDowngrade,
		allowDowngrade: options?.allowDowngrade ?? false,
		updateInProgress: settings.updateInProgress,
		disk,
		activeDeployments,
		lastInstanceBackupAt,
		currentDigest: running,
		remoteDigest: remote.digest,
		registryError: remote.error,
		release,
		readiness,
	});
	const blocks = checks.filter((check) => check.level === "block").length;
	const warnings = checks.filter((check) => check.level === "warn").length;
	return {
		image,
		currentVersion,
		targetVersion,
		checks,
		ok: blocks === 0,
		blocks,
		warnings,
		checkedAt: new Date().toISOString(),
	};
}
