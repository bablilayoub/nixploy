import { access, chmod, mkdir } from "node:fs/promises";
import { getConfigDir } from "../../application/paths";
import type { DeploymentContext } from "../context";
import { shellQuote } from "../paths";

/**
 * Pinned-CLI installer for builders that ship GitHub release binaries but
 * no usable public docker image (nixpacks, railpack). The binary is
 * downloaded once into `$NIXPLOY_CONFIG_DIR/tools` and cached.
 */

export interface PinnedTool {
	/** Binary name; also the asset base name (`<name>-<version>-<target>.tar.gz`). */
	name: string;
	/** Release tag, e.g. "v1.41.0" — bump to upgrade. */
	version: string;
	/** GitHub "<owner>/<repo>". */
	repo: string;
	/** "<platform>-<arch>" → release asset target triple. */
	targets: Record<string, string>;
}

const exists = async (path: string): Promise<boolean> => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};

/** Resolve (downloading once, if needed) the pinned binary for this platform. */
export async function ensureToolBinary(ctx: DeploymentContext, tool: PinnedTool): Promise<string> {
	const dir = `${getConfigDir()}/tools`;
	const binary = `${dir}/${tool.name}`;
	if (await exists(binary)) return binary;

	const target = tool.targets[`${process.platform}-${process.arch}`];
	if (!target) {
		throw new Error(
			`${tool.name} has no prebuilt binary for ${process.platform}/${process.arch} — install ${tool.name} manually or choose another builder`,
		);
	}
	const url = `https://github.com/${tool.repo}/releases/download/${tool.version}/${tool.name}-${tool.version}-${target}.tar.gz`;
	ctx.logger.line(`Downloading ${tool.name} ${tool.version}...`);
	await mkdir(dir, { recursive: true });
	await ctx.run(`curl -fsSL ${shellQuote(url)} | tar -xz -C ${shellQuote(dir)} ${tool.name}`);
	await chmod(binary, 0o755);
	return binary;
}
