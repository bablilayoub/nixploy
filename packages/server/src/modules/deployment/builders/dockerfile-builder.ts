import { normalize } from "node:path";
import { parseEnv } from "../env";
import { shellQuote } from "../paths";
import { withBuildArgFlags } from "./build-env";
import { hasBuildx } from "./buildx";
import { prepareBuildCache } from "./cache";
import type { BuildInput } from "./index";

/** Resolve a user-supplied relative path, keeping it inside the build dir. */
export const resolveInside = (base: string, relative: string): string => {
	// `path.normalize` preserves a trailing slash on the base (e.g.
	// normalize("/a/b//") → "/a/b/"), which would break the containment check.
	const cleanBase = normalize(base).replace(/[/\\]+$/, "");
	const resolved = normalize(`${cleanBase}/${relative}`).replace(/(?<=.)[/\\]+$/, "");
	if (resolved !== cleanBase && !resolved.startsWith(`${cleanBase}/`)) {
		throw new Error(`Path escapes the build context: ${relative}`);
	}
	return resolved;
};

/**
 * Plain Dockerfile build. Honors the application's `dockerfile` (path
 * relative to the build dir, default `Dockerfile`), `dockerContextPath`
 * (build context, relative to the build dir), `dockerBuildStage`
 * (`--target`) and `buildArgs` (`KEY=VALUE` lines → `--build-arg`).
 * Uses BuildKit local cache when `useBuildCache` is true.
 */
export async function buildWithDockerfile(input: BuildInput, imageTag: string): Promise<void> {
	const { ctx, application, buildDir } = input;

	const dockerfilePath = resolveInside(buildDir, application.dockerfile ?? "Dockerfile");
	const contextPath = application.dockerContextPath
		? resolveInside(buildDir, application.dockerContextPath)
		: buildDir;

	const entries = parseEnv(application.buildArgs);
	for (const [, value] of entries) ctx.logger.addSecret(value);
	const target = application.dockerBuildStage
		? ` --target ${shellQuote(application.dockerBuildStage)}`
		: "";

	const cache = await prepareBuildCache(input);
	const cacheFlags = cache.buildxCacheFlags ? ` ${cache.buildxCacheFlags}` : "";

	// Secret-looking build args go through BuildKit `--secret` (a 0600 file on
	// the target server, never on argv and never in `docker history`); the
	// rest stay plain `--build-arg`s (security audit 2.4).
	await withBuildArgFlags(ctx, application.appName, entries, async (flags) => {
		if (flags.secretIds.length > 0) {
			ctx.logger.line(
				`Build secrets available to BuildKit: ${flags.secretIds.join(", ")} — ` +
					"read them with RUN --mount=type=secret,id=<NAME> cat /run/secrets/<NAME>",
			);
		}
		// `docker build` is the fallback when the host has no buildx plugin;
		// it cannot take `--secret` or the cache flags, which are already
		// empty in that case (see cache.ts / withBuildArgFlags).
		const builder = (await hasBuildx(ctx.serverId)) ? "docker buildx build --load" : "docker build";
		await ctx.run(
			`${builder} -f ${shellQuote(dockerfilePath)} -t ${shellQuote(imageTag)}${target}${flags.buildArgs}${flags.secrets}${cacheFlags} ${shellQuote(contextPath)}`,
		);
	});
}
