import { buildWithDockerfile } from "../deployment/builders/dockerfile-builder";
import type { DeploymentContext } from "../deployment/context";
import { type ComposeBuildTarget, composeBuildImageTag } from "./build";
import { getComposeCodeDir } from "./paths";
import type { ComposeRow } from "./source";

/**
 * Build the images of a compose stack's `build:` services.
 *
 * Nixploy builds them itself with the ordinary Dockerfile builder — the same
 * BuildKit secret handling, the same cache probing, the same hardening — and
 * hands `prepareComposeFiles` a service → image map so the rendered file only
 * ever pulls. Compose is never asked to build, so it never reads a host path.
 *
 * One image per build service, tagged `<appName>-<service>:<deploymentId>` so
 * a rollback to an older render still finds the images that render referenced.
 */
export async function buildComposeImages(
	ctx: DeploymentContext,
	composeRow: Pick<ComposeRow, "appName" | "buildArgs" | "serverId">,
	targets: readonly ComposeBuildTarget[],
	deploymentId: string,
	onBeforeService?: (serviceName: string) => Promise<void> | void,
): Promise<Map<string, string>> {
	const images = new Map<string, string>();
	if (targets.length === 0) return images;

	const codeDir = getComposeCodeDir(composeRow.appName);
	ctx.logger.line(
		`Building ${targets.length} service${targets.length === 1 ? "" : "s"} from source: ` +
			targets.map((target) => target.serviceName).join(", "),
	);

	for (const target of targets) {
		// Checkpoint between services so a cancel lands between builds rather
		// than only after the whole stack is built.
		await onBeforeService?.(target.serviceName);

		const imageTag = composeBuildImageTag(composeRow.appName, target.serviceName, deploymentId);
		ctx.logger.line(`[build ${target.serviceName}] ${target.context} → ${imageTag}`);

		// The Dockerfile builder is driven by an application-shaped row. Only
		// the build fields matter here; giving it the compose row's own build
		// args means one stack-wide set, which is what the UI edits.
		//
		// `dockerfile` is relative to the CONTEXT in compose's model but to the
		// build dir in the builder's, so it is joined here. Both halves were
		// already refused if they contained `..` (see `parseBuildBlock`), and
		// `resolveInside` re-checks containment against the real directory.
		const dockerfile =
			target.context === "." ? target.dockerfile : `${target.context}/${target.dockerfile}`;
		const synthetic = {
			appName: `${composeRow.appName}-${target.serviceName}`,
			dockerfile,
			dockerContextPath: target.context,
			dockerBuildStage: target.target,
			buildArgs: composeRow.buildArgs ?? null,
			// Per-service cache dir falls out of the synthetic appName.
			useBuildCache: true,
		} as unknown as Parameters<typeof buildWithDockerfile>[0]["application"];

		await buildWithDockerfile(
			{ ctx, application: synthetic, buildDir: codeDir, env: [] },
			imageTag,
		);
		images.set(target.serviceName, imageTag);
	}

	return images;
}
