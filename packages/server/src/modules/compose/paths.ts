import { join, normalize } from "node:path";

/**
 * Root of all Nixploy-managed on-disk state (compose files, clones, logs).
 * Matches the install layout (`/etc/nixploy`), overridable for dev/tests.
 */
export const NIXPLOY_CONFIG_DIR = process.env.NIXPLOY_CONFIG_DIR ?? "/etc/nixploy";

/** Overlay network every deployed compose service joins for Traefik routing. */
export const NIXPLOY_NETWORK = process.env.NIXPLOY_NETWORK ?? "nixploy-network";

/** Per-compose working directory: `<configDir>/compose/<appName>`. */
export const getComposeBaseDir = (appName: string) => join(NIXPLOY_CONFIG_DIR, "compose", appName);

/** Git sources are cloned into `<base>/code`. */
export const getComposeCodeDir = (appName: string) => join(getComposeBaseDir(appName), "code");

/** Merged `.env` file for a compose project. */
export const getComposeEnvPath = (appName: string) => join(getComposeBaseDir(appName), ".env");

/** Deployment log file for the fallback compose worker. */
export const getDeploymentLogPath = (deploymentId: string) =>
	join(NIXPLOY_CONFIG_DIR, "logs", `${deploymentId}.log`);

/**
 * Resolve the on-disk compose file path for a compose row.
 * - raw source: `<base>/docker-compose.yml`
 * - git sources: `<base>/code/<composePath>` (normalized, must stay inside `code/`)
 */
export const resolveComposeFilePath = (
	appName: string,
	sourceType: string,
	composePath: string,
) => {
	if (sourceType === "raw") {
		return join(getComposeBaseDir(appName), "docker-compose.yml");
	}
	const codeDir = getComposeCodeDir(appName);
	const resolved = normalize(join(codeDir, composePath));
	if (!resolved.startsWith(codeDir)) {
		throw new Error(`composePath escapes the code directory: ${composePath}`);
	}
	return resolved;
};

/** Single-quote a string for safe use inside a POSIX shell command. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
