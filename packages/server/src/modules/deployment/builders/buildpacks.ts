import { commandExists } from "../docker";
import { shellQuote } from "../paths";
import type { BuildInput } from "./index";

const PACK_IMAGE = "buildpacksio/pack:latest";
const DOCKER_SOCKET = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";

/**
 * Cloud Native Buildpacks (heroku/paketo) via `pack`. Best-effort: uses a
 * local `pack` binary when available (local server only), otherwise the
 * `buildpacksio/pack` image with the build dir mounted at /workspace.
 */
export async function buildWithPack(
	input: BuildInput,
	imageTag: string,
	builder: string,
): Promise<void> {
	const { ctx, buildDir, env } = input;
	const envFlags = env.map((entry) => `--env ${shellQuote(entry)}`).join(" ");

	if (!ctx.serverId && (await commandExists(null, "pack"))) {
		await ctx.run(
			`pack build ${shellQuote(imageTag)} --path ${shellQuote(buildDir)} --builder ${shellQuote(builder)} ${envFlags}`,
		);
		return;
	}

	await ctx.run(
		`docker run --rm ` +
			`-v ${shellQuote(DOCKER_SOCKET)}:/var/run/docker.sock ` +
			`-v ${shellQuote(buildDir)}:/workspace ` +
			`${PACK_IMAGE} build ${shellQuote(imageTag)} --path /workspace --builder ${shellQuote(builder)} ${envFlags}`,
	);
}
