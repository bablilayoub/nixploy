import { commandExists } from "../docker";
import { shellQuote } from "../paths";
import { withSourcedBuildEnv } from "./build-env";
import { prepareBuildCache } from "./cache";
import type { BuildInput } from "./index";
import { ensureToolBinary, RAILPACK_TOOL } from "./tools";

/**
 * Railpack builder (Railway's nixpacks successor). No public railpack
 * docker image exists, so the CLI runs on the host: an installed
 * `railpack` binary wins, otherwise a pinned release is downloaded into
 * the tools dir. On managed servers the binary is installed by
 * `cluster/servers.ts#setupServer` (the version lives in `./tools.ts`).
 */

const BUILDKIT_CONTAINER = "nixploy-buildkit";

export async function buildWithRailpack(input: BuildInput, imageTag: string): Promise<void> {
	const { ctx, buildDir, env } = input;

	let binary: string;
	if (await commandExists(ctx.serverId, "railpack")) {
		binary = "railpack";
	} else if (!ctx.serverId) {
		binary = await ensureToolBinary(ctx, RAILPACK_TOOL);
	} else {
		throw new Error(
			"railpack is not installed on this server — run Server → Setup again to install the pinned builders, install it manually (https://railpack.com), or choose another builder",
		);
	}

	// Railpack talks to a BuildKit daemon over GRPC (BUILDKIT_HOST) — the
	// docker socket alone is not enough. Keep a shared one running.
	ctx.logger.line("Ensuring buildkit daemon (nixploy-buildkit)...");
	await ctx.run(
		`docker start ${BUILDKIT_CONTAINER} >/dev/null 2>&1 || docker run -d --name ${BUILDKIT_CONTAINER} --privileged --restart unless-stopped moby/buildkit:latest`,
	);

	const cache = await prepareBuildCache(input);
	const noCache = cache.noCacheFlag ? ` ${cache.noCacheFlag}` : "";

	// Same as nixpacks: values through a 0600 env file, names on argv.
	await withSourcedBuildEnv(ctx, input.application.appName, env, async ({ prefix, flags }) => {
		await ctx.run(
			`${prefix}BUILDKIT_HOST=docker-container://${BUILDKIT_CONTAINER} ${binary} build ${shellQuote(buildDir)} --name ${shellQuote(imageTag)}${flags}${noCache}`,
		);
	});
}
