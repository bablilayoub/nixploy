import path from "node:path";

/**
 * Root directory where Nixploy keeps all on-disk state (app code, file
 * mounts, traefik dynamic config). Mirrors Dokploy's `/etc/dokploy`.
 */
export const getConfigDir = (): string =>
	process.env.NIXPLOY_CONFIG_DIR ?? process.env.NIXPLOY_DIR ?? "/etc/nixploy";

/** Per-service directory: `<configDir>/applications/<appName>`. */
export const getApplicationDir = (appName: string): string =>
	path.join(getConfigDir(), "applications", appName);

/**
 * Base directory where `file` mounts of an application are materialized:
 * `<configDir>/applications/<appName>/files`.
 */
export const getApplicationFilesDir = (appName: string): string =>
	path.join(getApplicationDir(appName), "files");

/** Wildcard DNS zone used for preview deployments (traefik.me-style). */
export const getWildcardDomain = (): string => process.env.NIXPLOY_WILDCARD_DOMAIN ?? "traefik.me";

/** Name of the attachable overlay network every swarm service joins. */
export const getSwarmNetwork = (): string => process.env.NIXPLOY_NETWORK ?? "nixploy-network";

/**
 * Resolve a file-mount `filePath` (user supplied, relative) to an absolute
 * host path inside the application's files dir. Rejects traversal outside
 * of the files dir.
 */
export const resolveFileMountPath = (appName: string, filePath: string): string => {
	const base = getApplicationFilesDir(appName);
	const resolved = path.resolve(base, filePath);
	if (resolved !== base && !resolved.startsWith(base + path.sep)) {
		throw new Error(`Invalid file mount path (escapes files dir): ${filePath}`);
	}
	return resolved;
};
