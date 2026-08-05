import { commandExists } from "../docker";
import { shellQuote } from "../paths";
import type { BuildInput } from "./index";
import { ensureToolBinary, type PinnedTool } from "./tools";

/**
 * Nixpacks builder. The ghcr.io/railwayapp/nixpacks image is only a Nix
 * base (no nixpacks binary), so the CLI runs on the host: an installed
 * `nixpacks` binary wins, otherwise a pinned release is downloaded into
 * the tools dir. Managed servers must have nixpacks installed themselves.
 */

const NIXPACKS: PinnedTool = {
	name: "nixpacks",
	version: "v1.41.0",
	repo: "railwayapp/nixpacks",
	targets: {
		"darwin-arm64": "aarch64-apple-darwin",
		"darwin-x64": "x86_64-apple-darwin",
		"linux-arm64": "aarch64-unknown-linux-musl",
		"linux-x64": "x86_64-unknown-linux-musl",
	},
};

export async function buildWithNixpacks(input: BuildInput, imageTag: string): Promise<void> {
	const { ctx, buildDir, env } = input;
	const envFlags = env.map((entry) => `--env ${shellQuote(entry)}`).join(" ");

	let binary: string;
	if (await commandExists(ctx.serverId, "nixpacks")) {
		binary = "nixpacks";
	} else if (!ctx.serverId) {
		binary = await ensureToolBinary(ctx, NIXPACKS);
	} else {
		throw new Error(
			"nixpacks is not installed on this server — install it (https://nixpacks.com) or choose another builder",
		);
	}

	await ctx.run(
		`${binary} build ${shellQuote(buildDir)} --name ${shellQuote(imageTag)} ${envFlags}`,
	);
}
