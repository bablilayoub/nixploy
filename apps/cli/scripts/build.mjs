import { spawn, spawnSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, toNamespacedPath } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = createRequire(import.meta.url).resolve("typescript/package.json");
// Match TypeScript's installed-package resolver, but own the native process
// directly: its JS launcher otherwise adds a child on Windows / older Node 22.
const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}/package.json`;
const platformManifest = createRequire(manifest).resolve(platformPackage);
let compiler = join(dirname(platformManifest), "lib", "tsc");
if (process.platform === "win32") {
	compiler += ".exe";
	if (compiler.length >= 248) compiler = toNamespacedPath(compiler);
}
const args = ["--project", fileURLToPath(new URL("tsconfig.build.json", root))];

// Always start with a clean, successful build, including when entering watch mode.
rmSync(new URL("dist/", root), { recursive: true, force: true });
const result = spawnSync(compiler, args, { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
chmodSync(new URL("dist/index.js", root), 0o755);

if (process.argv.includes("--watch")) {
	const child = spawn(compiler, [...args, "--watch", "--preserveWatchOutput"], {
		cwd: root,
		stdio: "inherit",
	});
	// Forward shutdown so stopping the build script also stops its compiler.
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => {
			process.exitCode = signal === "SIGINT" ? 130 : 143;
			child.kill(signal);
		});
	}
	child.once("error", (error) => {
		console.error(error);
		process.exitCode = 1;
	});
	child.once("exit", (code, signal) => {
		process.exitCode ??= code ?? (signal === "SIGINT" ? 130 : 143);
	});
}
