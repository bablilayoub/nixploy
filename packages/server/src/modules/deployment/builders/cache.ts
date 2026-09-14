import { getBuildCachePath, shellQuote } from "../paths";
import { BUILDX_MISSING_HINT, hasBuildx } from "./buildx";
import type { BuildInput } from "./index";

/**
 * Resolve BuildKit local cache flags for dockerfile / nixpacks / railpack builds.
 * Returns empty string when caching is disabled.
 */
export async function prepareBuildCache(input: BuildInput): Promise<{
	enabled: boolean;
	cacheDir: string;
	/** Flags for `docker buildx build` (--cache-from / --cache-to). */
	buildxCacheFlags: string;
	/** Extra nixpacks/railpack args when cache is off. */
	noCacheFlag: string;
}> {
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

	// The local cache exporter is a BuildKit feature: without buildx there is
	// nothing to cache into, and asking for it fails the build outright.
	if (!(await hasBuildx(input.ctx.serverId))) {
		input.ctx.logger.line(`Build cache: disabled — ${BUILDX_MISSING_HINT}`);
		return { enabled: false, cacheDir, buildxCacheFlags: "", noCacheFlag: "" };
	}

	// Create the cache dir on the build host (local or remote via ctx.run).
	await input.ctx.run(`mkdir -p ${shellQuote(cacheDir)}`);
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
