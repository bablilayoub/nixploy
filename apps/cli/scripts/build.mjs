import { spawn, spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = createRequire(import.meta.url).resolve("typescript/package.json");
const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
const compiler = fileURLToPath(new URL(bin.tsc, pathToFileURL(manifest)));
const args = [compiler, "--project", fileURLToPath(new URL("tsconfig.build.json", root))];

// Always start with a clean, successful build, including when entering watch mode.
rmSync(new URL("dist/", root), { recursive: true, force: true });
const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
chmodSync(new URL("dist/index.js", root), 0o755);

if (process.argv.includes("--watch")) {
	const child = spawn(process.execPath, [...args, "--watch", "--preserveWatchOutput"], {
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
