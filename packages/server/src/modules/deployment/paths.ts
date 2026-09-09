import fs from "node:fs";
import path from "node:path";

/**
 * Base directory for all Nixploy-managed state (code checkouts, compose
 * files, logs, metrics, file mounts, drop uploads, ssh keys, Traefik config).
 *
 * This is the single source of truth — `modules/{application,compose,traefik}/paths.ts`
 * re-export it so every subsystem resolves the same directory.
 *
 * Resolution order:
 * 1. `NIXPLOY_CONFIG_DIR` env var (always wins). `NIXPLOY_DIR` is accepted
 *    as a legacy alias.
 * 2. `./.nixploy-data` when developing on macOS as a non-root user
 *    (writing to /etc requires sudo there).
 * 3. `/etc/nixploy` (production default, matches install.sh).
 */
export function getConfigDir(): string {
	const configured = process.env.NIXPLOY_CONFIG_DIR ?? process.env.NIXPLOY_DIR;
	if (configured) {
		return configured;
	}
	if (
		process.platform === "darwin" &&
		typeof process.getuid === "function" &&
		process.getuid() !== 0
	) {
		return path.resolve(process.cwd(), ".nixploy-data");
	}
	return "/etc/nixploy";
}

/** `<config>/applications/<appName>` — per-service working directory. */
export const getAppBasePath = (appName: string): string =>
	path.join(getConfigDir(), "applications", appName);

/** `<config>/applications/<appName>/code` — where sources are checked out. */
export const getAppCodePath = (appName: string): string =>
	path.join(getAppBasePath(appName), "code");

/** `<config>/applications/<appName>/code.zip` — uploaded drop archive. */
export const getDropZipPath = (appName: string): string =>
	path.join(getAppBasePath(appName), "code.zip");

/** `<config>/files/<appName>` — materialized `file` mounts for a service. */
export const getFilesPath = (appName: string): string =>
	path.join(getConfigDir(), "files", appName);

/** `<config>/ssh` — private keys written for git-over-ssh clones. */
export const getSshKeysPath = (): string => path.join(getConfigDir(), "ssh");

/** Absolute path of a deployment's build log on disk. */
export const getDeploymentLogPath = (appName: string, deploymentId: string): string =>
	path.join(getConfigDir(), "logs", appName, `${deploymentId}.log`);

/** Sidecar JSON for Deploy Copilot auto/manual explain results. */
export const getDeploymentExplainPath = (logPath: string): string =>
	logPath.replace(/\.log$/i, ".explain.json");

/** Local BuildKit cache root for an application (`cache-from` / `cache-to`). */
export const getBuildCachePath = (appName: string): string =>
	path.join(getConfigDir(), "cache", "buildkit", appName);

export function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

/** Quote a string for safe inclusion in a POSIX shell command. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
