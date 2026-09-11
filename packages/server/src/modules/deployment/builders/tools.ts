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

/**
 * Nixpacks — the default builder. Bump `version` to upgrade; `setupServer`
 * installs this exact release on managed servers, so local and remote builds
 * stay on the same toolchain.
 */
export const NIXPACKS_TOOL: PinnedTool = {
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

/** Railpack — Railway's nixpacks successor. */
export const RAILPACK_TOOL: PinnedTool = {
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

/** Builders a managed server needs installed to run a Nixploy build itself. */
export const REMOTE_BUILDER_TOOLS: readonly PinnedTool[] = [NIXPACKS_TOOL, RAILPACK_TOOL];

/** Release asset URL of a pinned tool for one target triple. */
export const toolReleaseUrl = (tool: PinnedTool, target: string): string =>
	`https://github.com/${tool.repo}/releases/download/${tool.version}/${tool.name}-${tool.version}-${target}.tar.gz`;

/** Where `installRemoteBuilderCommand` puts the binary on a managed server. */
export const REMOTE_TOOL_DIR = "/usr/local/bin";

/**
 * Idempotent shell snippet that installs a pinned builder on a managed
 * server (product audit, Deploy #3: `setupServer` used to install Docker
 * only, so nixpacks — the DEFAULT builder — failed on every fresh remote).
 *
 * The architecture is resolved on the remote, not here: one setup run can
 * target an arm64 or an x86_64 host and the panel's own platform says
 * nothing about it. An already-installed binary (operator-managed, or a
 * previous run) is left alone, exactly like the local `ensureToolBinary`.
 */
export function installRemoteBuilderCommand(tool: PinnedTool, dir = REMOTE_TOOL_DIR): string {
	const amd64 = tool.targets["linux-x64"];
	const arm64 = tool.targets["linux-arm64"];
	if (!amd64 || !arm64) {
		throw new Error(`${tool.name} has no linux release targets to install remotely`);
	}
	return [
		"set -e",
		`if command -v ${tool.name} >/dev/null 2>&1; then echo "${tool.name} already installed: $(${tool.name} --version 2>/dev/null || echo unknown)"; exit 0; fi`,
		'case "$(uname -m)" in',
		`  x86_64|amd64) target=${shellQuote(amd64)} ;;`,
		`  aarch64|arm64) target=${shellQuote(arm64)} ;;`,
		`  *) echo "no ${tool.name} ${tool.version} build for $(uname -m)" >&2; exit 1 ;;`,
		"esac",
		`mkdir -p ${shellQuote(dir)}`,
		// `$target` is resolved above; the rest of the URL is a compile-time
		// constant (repo/version/name), never tenant input.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: `${target}` is shell, not JS.
		`curl -fsSL "${toolReleaseUrl(tool, "${target}")}" | tar -xz -C ${shellQuote(dir)} ${tool.name}`,
		`chmod 755 ${shellQuote(`${dir}/${tool.name}`)}`,
		`${shellQuote(`${dir}/${tool.name}`)} --version`,
	].join("\n");
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
	const url = toolReleaseUrl(tool, target);
	ctx.logger.line(`Downloading ${tool.name} ${tool.version}...`);
	await mkdir(dir, { recursive: true });
	await ctx.run(`curl -fsSL ${shellQuote(url)} | tar -xz -C ${shellQuote(dir)} ${tool.name}`);
	await chmod(binary, 0o755);
	return binary;
}
