import fs from "node:fs";
import path from "node:path";

/**
 * Base directory for all Nixploy-managed state (code checkouts, logs,
 * file mounts, drop uploads, ssh keys).
 *
 * Resolution order:
 * 1. `NIXPLOY_CONFIG_DIR` env var (always wins).
 * 2. `./.nixploy-data` when developing on macOS as a non-root user
 *    (writing to /etc requires sudo there).
 * 3. `/etc/nixploy` (production default, matches install.sh).
 */
export function getConfigDir(): string {
	if (process.env.NIXPLOY_CONFIG_DIR) {
		return process.env.NIXPLOY_CONFIG_DIR;
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

export function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

/** Quote a string for safe inclusion in a POSIX shell command. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
