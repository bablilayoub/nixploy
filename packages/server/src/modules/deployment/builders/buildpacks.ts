import { commandExists } from "../docker";
import { shellQuote } from "../paths";
import { withEnvFileFlag } from "./build-env";
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

	// `pack` reads build variables from a file (`--env-file`), so no value
	// ever reaches argv (security audit 2.4).
	await withEnvFileFlag(ctx, input.application.appName, env, async ({ flag, path }) => {
		if (!ctx.serverId && (await commandExists(null, "pack"))) {
			await ctx.run(
				`pack build ${shellQuote(imageTag)} --path ${shellQuote(buildDir)} --builder ${shellQuote(builder)}${flag}`,
			);
			return;
		}

		// The containerized `pack` needs the file visible inside the container:
		// bind it read-only at the same absolute path the flag names.
		const mount = path ? `-v ${shellQuote(`${path}:${path}:ro`)} ` : "";
		await ctx.run(
			`docker run --rm ` +
				`-v ${shellQuote(DOCKER_SOCKET)}:/var/run/docker.sock ` +
				`-v ${shellQuote(buildDir)}:/workspace ` +
				mount +
				`${PACK_IMAGE} build ${shellQuote(imageTag)} --path /workspace --builder ${shellQuote(builder)}${flag}`,
		);
	});
}
