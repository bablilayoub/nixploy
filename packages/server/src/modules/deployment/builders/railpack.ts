import { commandExists } from "../docker";
import { shellQuote } from "../paths";
import { prepareBuildCache } from "./cache";
import type { BuildInput } from "./index";
import { ensureToolBinary, type PinnedTool } from "./tools";

/**
 * Railpack builder (Railway's nixpacks successor). No public railpack
 * docker image exists, so the CLI runs on the host: an installed
 * `railpack` binary wins, otherwise a pinned release is downloaded into
 * the tools dir. Managed servers must have railpack installed themselves.
 */

const BUILDKIT_CONTAINER = "nixploy-buildkit";

const RAILPACK: PinnedTool = {
	name: "railpack",
	version: "v0.35.0",
	repo: "railwayapp/railpack",
	targets: {
		"darwin-arm64": "arm64-apple-darwin",
		"darwin-x64": "x86_64-apple-darwin",
		"linux-arm64": "arm64-unknown-linux-musl",
		"linux-x64": "x86_64-unknown-linux-musl",
	},
};

export async function buildWithRailpack(input: BuildInput, imageTag: string): Promise<void> {
	const { ctx, buildDir, env } = input;
	const envFlags = env.map((entry) => `--env ${shellQuote(entry)}`).join(" ");

	let binary: string;
	if (await commandExists(ctx.serverId, "railpack")) {
		binary = "railpack";
	} else if (!ctx.serverId) {
		binary = await ensureToolBinary(ctx, RAILPACK);
	} else {
		throw new Error(
			"railpack is not installed on this server — install it (https://railpack.com) or choose another builder",
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

	await ctx.run(
		`BUILDKIT_HOST=docker-container://${BUILDKIT_CONTAINER} ${binary} build ${shellQuote(buildDir)} --name ${shellQuote(imageTag)} ${envFlags}${noCache}`,
	);
}
