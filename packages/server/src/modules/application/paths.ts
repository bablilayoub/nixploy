import path from "node:path";
import { getConfigDir } from "../deployment/paths";
import { badRequest } from "../errors";

/** Root directory where Nixploy keeps all on-disk state — see `deployment/paths.ts`. */
export { getConfigDir };

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
		throw badRequest(`Invalid file mount path (escapes files dir): ${filePath}`);
	}
	return resolved;
};
