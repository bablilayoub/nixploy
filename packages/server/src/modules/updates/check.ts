import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execAsync } from "../../utils/exec";
import { shellQuote } from "../deployment/paths";
import { fetchRemoteDigest, normalizeDigest, parseImageRef } from "./registry";
import {
	fetchLatestRelease,
	fetchRelease,
	imageVersionTag,
	parseVersion,
	type ReleaseInfo,
} from "./releases";
import { getUpdateSettings, patchUpdateSettings, type UpdateSettings } from "./settings";

export const NIXPLOY_SERVICE_NAME = "nixploy";

export function getAppVersion(): string {
	if (process.env.NIXPLOY_APP_VERSION?.trim()) {
		return process.env.NIXPLOY_APP_VERSION.trim();
	}
	for (const candidate of [
		join(process.cwd(), "package.json"),
		"/app/package.json",
		join(process.cwd(), "../../package.json"),
	]) {
		try {
			const version = JSON.parse(readFileSync(candidate, "utf8")).version;
			if (typeof version === "string" && version.trim()) return version.trim();
		} catch {
			// try next path
		}
	}
	return "0.1.0";
}

/** Image currently configured on the Swarm service (may include @digest). */
export async function getRunningImageRef(): Promise<string | null> {
	try {
		const stdout = await execAsync(
			`docker service inspect ${NIXPLOY_SERVICE_NAME} --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'`,
			{ timeout: 15_000 },
		);
		const image = stdout.trim();
		return image || null;
	} catch {
		return null;
	}
}

/** Pick the RepoDigest of `repository` (falls back to the first digest). */
function pickRepoDigest(stdout: string, repository: string): string | null {
	let first: string | null = null;
	for (const line of stdout.split("\n")) {
		const digest = normalizeDigest(line);
		if (!digest) continue;
		if (line.trim().startsWith(`${repository}@`)) return digest;
		first ??= digest;
	}
	return first;
}

/**
 * Digest of the image the RUNNING task of the service was started from.
 *
 * The service spec carries no digest (`--no-resolve-image`) and the local
 * tag is re-pointed by `docker pull` before the roll — so after a failed or
 * never-converging update the tag already equals the remote digest while the
 * old container still runs. Task → container → image ID → RepoDigests is the
 * only view that reflects what is actually serving.
 */
async function getRunningTaskDigest(repository: string): Promise<string | null> {
	try {
		const taskIds = (
			await execAsync(
				`docker service ps ${shellQuote(NIXPLOY_SERVICE_NAME)} --filter desired-state=running --format '{{.ID}}'`,
				{ timeout: 15_000 },
			)
		)
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		for (const taskId of taskIds) {
			const containerId = (
				await execAsync(
					`docker inspect --format '{{.Status.ContainerStatus.ContainerID}}' ${shellQuote(taskId)}`,
					{ timeout: 15_000 },
				)
			).trim();
			if (!containerId) continue;
			const imageId = (
				await execAsync(`docker inspect --format '{{.Image}}' ${shellQuote(containerId)}`, {
					timeout: 15_000,
				})
			).trim();
			if (!imageId) continue;
			const digests = await execAsync(
				`docker image inspect ${shellQuote(imageId)} --format '{{range .RepoDigests}}{{println .}}{{end}}'`,
				{ timeout: 15_000 },
			);
			const digest = pickRepoDigest(digests, repository);
			if (digest) return digest;
		}
	} catch {
		// Not a manager, task not started yet, or image already pruned.
	}
	return null;
}

/**
 * Resolve the digest the running service is actually on.
 * Prefers an `@sha256` suffix on the service image, then the running task's
 * image (see {@link getRunningTaskDigest}); the local tag's RepoDigests are
 * only a last resort because `docker pull` re-points them before the roll.
 */
export async function getRunningDigest(imageRef: string | null): Promise<string | null> {
	if (!imageRef) return null;
	const parsed = parseImageRef(imageRef);
	if (parsed.digest) return normalizeDigest(parsed.digest);

	const repository = `${parsed.registry}/${parsed.repository}`;
	const running = await getRunningTaskDigest(repository);
	if (running) return running;

	try {
		const stdout = await execAsync(
			`docker image inspect ${shellQuote(imageRef)} --format '{{range .RepoDigests}}{{println .}}{{end}}'`,
			{ timeout: 15_000 },
		);
		return pickRepoDigest(stdout, repository);
	} catch {
		// Image may not be present locally (rare after a clean prune).
	}
	return null;
}

export interface UpdateCheckResult {
	appVersion: string;
	serviceName: string;
	currentImage: string | null;
	currentDigest: string | null;
	latestImage: string;
	latestDigest: string | null;
	updateAvailable: boolean;
	checkedAt: string;
	settings: UpdateSettings;
	error: string | null;
	/**
	 * Release the tracked image points at: the release for the image's version
	 * tag, or the newest release when the image is a moving tag (`:latest`).
	 * Null when the repository has no matching release or GitHub was
	 * unreachable — release notes never fail a check.
	 */
	release: ReleaseInfo | null;
}

/**
 * Release the operator is being offered. A pinned version tag resolves that
 * exact release; `:latest` (and any non-semver tag) resolves the newest one.
 * Never throws: notes are an explanation, not a precondition.
 */
export async function resolveTargetRelease(image: string): Promise<ReleaseInfo | null> {
	try {
		const tag = imageVersionTag(image);
		return parseVersion(tag) ? await fetchRelease(tag) : await fetchLatestRelease();
	} catch {
		// Rate limited, offline, or an air-gapped install — carry on without notes.
		return null;
	}
}

export async function checkForUpdates(options?: {
	/** Persist the result into web-server settings (default true). */
	persist?: boolean;
}): Promise<UpdateCheckResult> {
	const settings = await getUpdateSettings();
	const latestImage = settings.image;
	const checkedAt = new Date().toISOString();
	const appVersion = getAppVersion();

	let currentImage: string | null = null;
	let currentDigest: string | null = null;
	let latestDigest: string | null = null;
	let error: string | null = null;

	try {
		currentImage = await getRunningImageRef();
		currentDigest = await getRunningDigest(currentImage);
		latestDigest = await fetchRemoteDigest(latestImage);

		if (!latestDigest) {
			error = `Could not reach the registry for ${latestImage}`;
		} else if (!currentDigest) {
			// First boot / no-resolve-image without a local digest — treat as
			// "maybe outdated" only when we have something to compare later.
			error = null;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}

	const updateAvailable =
		!!latestDigest && !!currentDigest && latestDigest !== currentDigest && !error;

	const release = await resolveTargetRelease(latestImage);

	const result: UpdateCheckResult = {
		appVersion,
		serviceName: NIXPLOY_SERVICE_NAME,
		currentImage,
		currentDigest,
		latestImage,
		latestDigest,
		updateAvailable,
		checkedAt,
		settings,
		error,
		release,
	};

	if (options?.persist !== false) {
		await patchUpdateSettings({
			lastCheckedAt: checkedAt,
			latestDigest,
			currentDigest,
			updateAvailable,
			lastError: error,
			// Cached with the check so `updates.getStatus` can render notes
			// without hitting GitHub on every dashboard poll.
			...(release && {
				releaseTag: release.tag,
				releaseNotes: release.notes,
				releaseUrl: release.url,
			}),
		});
		result.settings = await getUpdateSettings();
	}

	return result;
}
