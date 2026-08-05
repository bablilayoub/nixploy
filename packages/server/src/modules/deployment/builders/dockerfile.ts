import { normalize } from "node:path";
import { parseEnv } from "../env";
import { shellQuote } from "../paths";
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
 */
export async function buildWithDockerfile(input: BuildInput, imageTag: string): Promise<void> {
	const { ctx, application, buildDir } = input;

	const dockerfilePath = resolveInside(buildDir, application.dockerfile ?? "Dockerfile");
	const contextPath = application.dockerContextPath
		? resolveInside(buildDir, application.dockerContextPath)
		: buildDir;

	const buildArgs = parseEnv(application.buildArgs)
		.map(([key, value]) => {
			ctx.logger.addSecret(value);
			return `--build-arg ${shellQuote(`${key}=${value}`)}`;
		})
		.join(" ");
	const target = application.dockerBuildStage
		? ` --target ${shellQuote(application.dockerBuildStage)}`
		: "";

	await ctx.run(
		`docker build -f ${shellQuote(dockerfilePath)} -t ${shellQuote(imageTag)}${target} ${buildArgs} ${shellQuote(contextPath)}`,
	);
}
