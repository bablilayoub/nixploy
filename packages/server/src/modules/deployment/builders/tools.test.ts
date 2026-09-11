import { describe, expect, it } from "vitest";
import {
	installRemoteBuilderCommand,
	NIXPACKS_TOOL,
	RAILPACK_TOOL,
	REMOTE_BUILDER_TOOLS,
	REMOTE_TOOL_DIR,
	toolReleaseUrl,
} from "./tools";

describe("toolReleaseUrl", () => {
	it("points at the pinned GitHub release asset", () => {
		expect(toolReleaseUrl(NIXPACKS_TOOL, "aarch64-unknown-linux-musl")).toBe(
			"https://github.com/railwayapp/nixpacks/releases/download/v1.41.0/nixpacks-v1.41.0-aarch64-unknown-linux-musl.tar.gz",
		);
	});
});

describe("installRemoteBuilderCommand", () => {
	it("installs the pinned nixpacks release, resolving the arch on the remote", () => {
		expect(installRemoteBuilderCommand(NIXPACKS_TOOL)).toBe(
			[
				"set -e",
				`if command -v nixpacks >/dev/null 2>&1; then echo "nixpacks already installed: $(nixpacks --version 2>/dev/null || echo unknown)"; exit 0; fi`,
				'case "$(uname -m)" in',
				"  x86_64|amd64) target='x86_64-unknown-linux-musl' ;;",
				"  aarch64|arm64) target='aarch64-unknown-linux-musl' ;;",
				'  *) echo "no nixpacks v1.41.0 build for $(uname -m)" >&2; exit 1 ;;',
				"esac",
				"mkdir -p '/usr/local/bin'",
				`curl -fsSL "https://github.com/railwayapp/nixpacks/releases/download/v1.41.0/nixpacks-v1.41.0-\${target}.tar.gz" | tar -xz -C '/usr/local/bin' nixpacks`,
				"chmod 755 '/usr/local/bin/nixpacks'",
				"'/usr/local/bin/nixpacks' --version",
			].join("\n"),
		);
	});

	it("installs railpack from its own repo and version", () => {
		const command = installRemoteBuilderCommand(RAILPACK_TOOL);
		expect(command).toContain("railwayapp/railpack/releases/download/v0.35.0/");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the shell literal.
		expect(command).toContain("railpack-v0.35.0-${target}.tar.gz");
		expect(command).toContain("  aarch64|arm64) target='arm64-unknown-linux-musl' ;;");
	});

	it("is idempotent: an already-installed binary short-circuits", () => {
		expect(installRemoteBuilderCommand(NIXPACKS_TOOL).split("\n")[1]).toContain("exit 0");
	});

	it("honours a custom install directory", () => {
		expect(installRemoteBuilderCommand(NIXPACKS_TOOL, "/opt/bin")).toContain(
			"chmod 755 '/opt/bin/nixpacks'",
		);
		expect(REMOTE_TOOL_DIR).toBe("/usr/local/bin");
	});

	it("covers every builder a managed server needs", () => {
		expect(REMOTE_BUILDER_TOOLS.map((tool) => tool.name)).toEqual(["nixpacks", "railpack"]);
	});
});
