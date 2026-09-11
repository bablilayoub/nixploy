import type { DeploymentContext } from "../context";
import type { ApplicationRow } from "../sources";
import { buildWithPack } from "./buildpacks";
import { buildWithDockerfile } from "./dockerfile-builder";
import { buildWithNixpacks } from "./nixpacks";
import { buildWithRailpack } from "./railpack";
import { buildStatic } from "./static";

export interface BuildInput {
	ctx: DeploymentContext;
	application: ApplicationRow;
	/** Absolute path of the build context on the target server. */
	buildDir: string;
	/**
	 * Build-time variables (`KEY=VALUE` entries) — the application's build
	 * args, not the merged runtime env (see `resolveBuildEnv` in `../env.ts`).
	 * Passed as `--env` to nixpacks/railpack/pack; the Dockerfile builder
	 * reads `application.buildArgs` directly as `--build-arg`.
	 */
	env: string[];
}

/**
 * Build the application's image with the builder selected by `buildType`.
 * Returns the image tag the swarm service should run.
 * All output is streamed to the deployment log through `ctx.run`.
 */
export async function buildImage(input: BuildInput): Promise<string> {
	const imageTag = `${input.application.appName}:latest`;
	input.ctx.logger.line(`Building image ${imageTag} (${input.application.buildType})...`);

	switch (input.application.buildType) {
		case "dockerfile":
			await buildWithDockerfile(input, imageTag);
			break;
		case "nixpacks":
			await buildWithNixpacks(input, imageTag);
			break;
		case "static":
			await buildStatic(input, imageTag);
			break;
		case "heroku_buildpacks":
			await buildWithPack(input, imageTag, "heroku/builder:24");
			break;
		case "paketo_buildpacks":
			await buildWithPack(input, imageTag, "paketobuildpacks/builder-jammy-base");
			break;
		case "railpack":
			await buildWithRailpack(input, imageTag);
			break;
		default:
			throw new Error(`Unsupported build type: ${input.application.buildType}`);
	}

	input.ctx.logger.line(`Image ${imageTag} built successfully`);
	return imageTag;
}
