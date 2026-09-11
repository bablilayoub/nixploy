import { commandExists } from "../docker";
import { shellQuote } from "../paths";
import { prepareBuildCache } from "./cache";
import type { BuildInput } from "./index";
import { ensureToolBinary, NIXPACKS_TOOL } from "./tools";

/**
 * Nixpacks builder. The ghcr.io/railwayapp/nixpacks image is only a Nix
 * base (no nixpacks binary), so the CLI runs on the host: an installed
 * `nixpacks` binary wins, otherwise a pinned release is downloaded into
 * the tools dir. On managed servers the binary is installed by
 * `cluster/servers.ts#setupServer` (the version lives in `./tools.ts`).
 */

export async function buildWithNixpacks(input: BuildInput, imageTag: string): Promise<void> {
	const { ctx, buildDir, env } = input;
	const envFlags = env.map((entry) => `--env ${shellQuote(entry)}`).join(" ");

	let binary: string;
	if (await commandExists(ctx.serverId, "nixpacks")) {
		binary = "nixpacks";
	} else if (!ctx.serverId) {
		binary = await ensureToolBinary(ctx, NIXPACKS_TOOL);
	} else {
		// Server setup installs it; an older server (or a failed install step)
		// still lands here, so the message says how to fix it rather than
		// leaving the operator to guess the install command.
		throw new Error(
			"nixpacks is not installed on this server — run Server → Setup again to install the pinned builders, install it manually (https://nixpacks.com), or choose another builder",
		);
	}

	const cache = await prepareBuildCache(input);
	const noCache = cache.noCacheFlag ? ` ${cache.noCacheFlag}` : "";
	const cacheKey = cache.enabled
		? ` --cache-key ${shellQuote(`nixploy-${input.application.appName}`)}`
		: "";

	await ctx.run(
		`${binary} build ${shellQuote(buildDir)} --name ${shellQuote(imageTag)} ${envFlags}${noCache}${cacheKey}`,
	);
}
