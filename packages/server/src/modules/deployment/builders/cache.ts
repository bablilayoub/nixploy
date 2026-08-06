import { ensureDir, getBuildCachePath, shellQuote } from "../paths";
import type { BuildInput } from "./index";

/**
 * Resolve BuildKit local cache flags for dockerfile / nixpacks / railpack builds.
 * Returns empty string when caching is disabled.
 */
export function prepareBuildCache(input: BuildInput): {
	enabled: boolean;
	cacheDir: string;
	/** Flags for `docker buildx build` (--cache-from / --cache-to). */
	buildxCacheFlags: string;
	/** Extra nixpacks/railpack args when cache is off. */
	noCacheFlag: string;
} {
	const appName = input.application.appName;
	const enabled = input.application.useBuildCache !== false;
	const cacheDir = getBuildCachePath(appName);

	if (!enabled) {
		input.ctx.logger.line("Build cache: disabled (fresh layers)");
		return {
			enabled: false,
			cacheDir,
			buildxCacheFlags: "",
			noCacheFlag: "--no-cache",
		};
	}

	ensureDir(cacheDir);
	input.ctx.logger.line(`Build cache: enabled → ${cacheDir}`);
	input.ctx.logger.line("Hint: lines with CACHED in the build output are cache hits");

	const src = shellQuote(cacheDir);
	return {
		enabled: true,
		cacheDir,
		buildxCacheFlags: `--cache-from type=local,src=${src} --cache-to type=local,dest=${src},mode=max`,
		noCacheFlag: "",
	};
}
