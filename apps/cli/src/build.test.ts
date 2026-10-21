import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function killOwned(pid: number): void {
	try {
		process.kill(pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

async function until(check: () => Promise<boolean>, label: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await pause(50);
	}
	throw new Error(`Timed out waiting for ${label}`);
}

test("watch owns and stops the native compiler when Node execve is unavailable", async () => {
	const scratch = await realpath(await mkdtemp(join(tmpdir(), "nixploy-cli-watch-test-")));
	// TypeScript 7 excludes shallow paths from watching. Nest the temporary
	// project so Linux /tmp fixtures exercise real watch subscriptions.
	const project = join(scratch, "workspace", "cli");
	const typescript = createRequire(import.meta.url).resolve("typescript/package.json");
	const { default: getExePath } = await import(
		pathToFileURL(join(dirname(typescript), "lib/getExePath.js")).href
	);
	const compiler = getExePath();
	const source = join(project, "src/index.ts");
	const output = join(project, "dist/index.js");
	const trace = join(scratch, "spawn.jsonl");
	let watcher: ReturnType<typeof spawn> | undefined;
	let compilerPid: number | undefined;
	let log = "";
	try {
		await mkdir(project, { recursive: true });
		await mkdir(join(project, "scripts"));
		await mkdir(join(project, "src"));
		await mkdir(join(project, "node_modules"));
		await symlink(dirname(typescript), join(project, "node_modules/typescript"), "junction");
		await writeFile(
			join(project, "scripts/build.mjs"),
			await readFile(new URL("../scripts/build.mjs", import.meta.url)),
		);
		await writeFile(
			join(project, "tsconfig.build.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ES2022",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					lib: ["ES2023"],
					types: [],
					rootDir: "src",
					outDir: "dist",
					noEmitOnError: true,
				},
				include: ["src/**/*.ts"],
			}),
		);
		await writeFile(source, '#!/usr/bin/env node\nexport const value = "before";\n');
		const preload = join(project, "without-execve.mjs");
		await writeFile(
			preload,
			`import cp from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
process.execve = undefined;
// Windows process.kill terminates without delivering a console signal. Exercise
// the wrapper's Ctrl-C handler over IPC there; POSIX receives an actual SIGTERM.
process.on("message", message => {
  if (message === "interrupt") process.emit("SIGINT");
});
process.channel?.unref();
const spawn = cp.spawn;
cp.spawn = (...args) => {
  const child = spawn(...args);
  appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ command: args[0], pid: child.pid }) + "\\n");
  return child;
};
syncBuiltinESMExports();
`,
		);
		// Keep only platform necessities; no inherited credentials or Node preloads.
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([key]) =>
				/^(path|home|userprofile|systemroot|windir|comspec|tmpdir|tmp|temp)$/i.test(key),
			),
		);
		watcher = spawn(process.execPath, ["scripts/build.mjs", "--watch"], {
			cwd: project,
			env: { ...env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			detached: process.platform !== "win32",
		});
		watcher.stdout?.on("data", (chunk) => {
			log += chunk;
		});
		watcher.stderr?.on("data", (chunk) => {
			log += chunk;
		});
		await until(async () => log.includes("Watching for file changes."), "watch startup");
		const child = JSON.parse((await readFile(trace, "utf8")).trim());
		compilerPid = child.pid;
		// TypeScript's official resolver is the oracle for the installed platform asset.
		expect(child.command).toBe(compiler);
		expect(compilerPid).toBeTypeOf("number");
		await writeFile(source, '#!/usr/bin/env node\nexport const value = "after";\n');
		await until(async () => (await readFile(output, "utf8")).includes('"after"'), "rebuild");
		const rebuilt = await readFile(output, "utf8");
		await writeFile(source, 'export const value: number = "invalid";\n');
		await until(async () => log.includes("TS2322"), "type error");
		expect(await readFile(output, "utf8")).toBe(rebuilt);
		await writeFile(source, '#!/usr/bin/env node\nexport const value = "recovered";\n');
		await until(
			async () => (await readFile(output, "utf8")).includes('"recovered"'),
			"watch recovery",
		);
		const exited = once(watcher, "exit", { signal: AbortSignal.timeout(5000) });
		if (process.platform === "win32") watcher.send("interrupt");
		else watcher.kill("SIGTERM");
		expect((await exited)[0]).toBe(process.platform === "win32" ? 130 : 143);
		await until(async () => compilerPid !== undefined && !alive(compilerPid), "compiler shutdown");
		const stopped = await readFile(output, "utf8");
		await writeFile(source, 'export const value = "must not compile after stop";\n');
		await pause(200);
		expect(await readFile(output, "utf8")).toBe(stopped);
	} finally {
		// A regressed launcher may have grandchildren: clean only this owned process tree.
		if (watcher?.pid) {
			if (process.platform === "win32") {
				if (alive(watcher.pid)) {
					spawnSync("taskkill", ["/pid", String(watcher.pid), "/t", "/f"], { timeout: 5000 });
				}
			} else {
				killOwned(-watcher.pid);
			}
		}
		if (compilerPid && alive(compilerPid)) killOwned(compilerPid);
		await rm(scratch, { recursive: true, force: true });
	}
}, 30_000);
