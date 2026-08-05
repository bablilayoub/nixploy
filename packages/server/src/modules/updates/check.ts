import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execAsync } from "../../utils/exec";
import { fetchRemoteDigest, normalizeDigest, parseImageRef } from "./registry";
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

/**
 * Resolve the digest the running service is actually on.
 * Prefers an `@sha256` suffix on the service image; otherwise asks the local
 * docker engine for RepoDigests of that tag.
 */
export async function getRunningDigest(imageRef: string | null): Promise<string | null> {
	if (!imageRef) return null;
	const parsed = parseImageRef(imageRef);
	if (parsed.digest) return normalizeDigest(parsed.digest);

	try {
		const stdout = await execAsync(
			`docker image inspect ${JSON.stringify(imageRef)} --format '{{range .RepoDigests}}{{println .}}{{end}}'`,
			{ timeout: 15_000 },
		);
		for (const line of stdout.split("\n")) {
			const digest = normalizeDigest(line);
			if (digest) return digest;
		}
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
	};

	if (options?.persist !== false) {
		await patchUpdateSettings({
			lastCheckedAt: checkedAt,
			latestDigest,
			currentDigest,
			updateAvailable,
			lastError: error,
		});
		result.settings = await getUpdateSettings();
	}

	return result;
}
