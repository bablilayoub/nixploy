/**
 * Env vars are stored as `KEY=VALUE` lines (one per line, `#` comments
 * allowed). They inherit downward: project → environment → service,
 * with deeper levels overriding by key.
 */

/** Parse `KEY=VALUE` lines into entries, skipping blanks and comments. */
export function parseEnv(env: string | null | undefined): Array<[string, string]> {
	if (!env) return [];
	const entries: Array<[string, string]> = [];
	for (const rawLine of env.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		entries.push([line.slice(0, eq).trim(), line.slice(eq + 1)]);
	}
	return entries;
}

/** Merge env layers; later layers override earlier ones by key. */
export function mergeEnv(...layers: Array<string | null | undefined>): string {
	const map = new Map<string, string>();
	for (const layer of layers) {
		for (const [key, value] of parseEnv(layer)) {
			map.set(key, value);
		}
	}
	return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("\n");
}

/** Parse into the `KEY=VALUE` array docker expects. */
export function envToArray(env: string | null | undefined): string[] {
	return parseEnv(env).map(([k, v]) => `${k}=${v}`);
}

/** Escape hatch: `NIXPLOY_BUILD_WITH_RUNTIME_ENV=1` restores the pre-0020 behaviour. */
export const BUILD_WITH_RUNTIME_ENV = "NIXPLOY_BUILD_WITH_RUNTIME_ENV";

/**
 * Variables handed to the image builders (nixpacks / railpack / pack as
 * `--env`; the Dockerfile builder reads `buildArgs` itself). Only the
 * application's build args by default: runtime secrets (database URLs, API
 * keys) used to flow into the build, where nixpacks-style builders bake
 * them into image layers and the BuildKit cache. Operators who relied on
 * that can set {@link BUILD_WITH_RUNTIME_ENV}; build args still win over
 * runtime values by key.
 */
export function resolveBuildEnv(
	buildArgs: string | null | undefined,
	runtimeEnv: string | null | undefined,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	if (env[BUILD_WITH_RUNTIME_ENV] === "1") {
		return envToArray(mergeEnv(runtimeEnv, buildArgs));
	}
	return envToArray(buildArgs);
}
