import { join, normalize, sep } from "node:path";
import { getConfigDir } from "../deployment/paths";

/** Root of all Nixploy-managed on-disk state — see `deployment/paths.ts`. */
export { getConfigDir };

/** Per-compose working directory: `<configDir>/compose/<appName>`. */
export const getComposeBaseDir = (appName: string) => join(getConfigDir(), "compose", appName);

/** Git sources are cloned into `<base>/code`. */
export const getComposeCodeDir = (appName: string) => join(getComposeBaseDir(appName), "code");

/** Merged `.env` file for a compose project. */
export const getComposeEnvPath = (appName: string) => join(getComposeBaseDir(appName), ".env");

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
	if (resolved !== codeDir && !resolved.startsWith(codeDir + sep)) {
		throw new Error(`composePath escapes the code directory: ${composePath}`);
	}
	return resolved;
};

/** Single-quote a string for safe use inside a POSIX shell command. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
