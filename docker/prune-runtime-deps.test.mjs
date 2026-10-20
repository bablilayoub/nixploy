import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pruneRuntimeDependencies } from "./prune-runtime-deps.mjs";

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "nixploy-runtime-deps-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	async function manifest(path, data) {
		await mkdir(path, { recursive: true });
		await writeFile(join(path, "package.json"), JSON.stringify(data));
		return path;
	}
	async function link(from, name, target) {
		const path = join(from, "node_modules", name);
		await mkdir(dirname(path), { recursive: true });
		await symlink(target, path);
	}
	const web = await manifest(join(root, "apps/web"), {
		name: "web",
		dependencies: { tsx: "*", server: "workspace:*" },
	});
	const server = await manifest(join(root, "packages/server"), {
		name: "server",
		dependencies: { auth: "*" },
	});
	await link(web, "server", server);
	async function pkg(name, data = {}) {
		return manifest(
			join(root, "node_modules/.pnpm", `${name.replaceAll("/", "+")}@1`, "node_modules", name),
			{ name, version: "1", ...data },
		);
	}
	const tsx = await pkg("tsx", { dependencies: { esbuild: "*" } });
	const esbuild = await pkg("esbuild", {
		optionalDependencies: { "@esbuild/linux-arm64": "*", "@esbuild/linux-x64": "*" },
	});
	const native = await pkg("@esbuild/linux-arm64");
	await writeFile(join(native, "esbuild"), "runtime compiler");
	await link(web, "tsx", tsx);
	await link(tsx, "esbuild", esbuild);
	await link(esbuild, "@esbuild/linux-arm64", native);
	const auth = await pkg("auth", {
		peerDependencies: { "drizzle-kit": "*", typescript: "*", vitest: "*" },
	});
	await link(server, "auth", auth);
	const omitted = [];
	for (const name of [
		"drizzle-kit",
		"typescript",
		"vitest",
		"@typescript/typescript-linux-arm64",
		"esbuild-build-only",
		"shadcn",
	]) {
		const path = await pkg(name);
		omitted.push(path);
		await link(auth, name, path);
	}
	return { root, web, native, omitted, manifest };
}

test("keeps workspace/native runtime dependencies; omits compiler, schema and test peers", async (t) => {
	const f = await fixture(t);
	await pruneRuntimeDependencies(f.root);
	assert.equal(await readFile(join(f.native, "esbuild"), "utf8"), "runtime compiler");
	for (const path of f.omitted) await assert.rejects(access(path), { code: "ENOENT" });
	await pruneRuntimeDependencies(f.root);
	await access(f.native);
});

test("a new direct build-tool dependency fails instead of silently removing it", async (t) => {
	const f = await fixture(t);
	await f.manifest(f.web, { name: "web", dependencies: { typescript: "*" } });
	await assert.rejects(
		pruneRuntimeDependencies(f.root),
		/requires build tool typescript at runtime/,
	);
	for (const path of f.omitted) await access(path);
});

test("a broken required runtime link fails before deleting packages", async (t) => {
	const f = await fixture(t);
	await f.manifest(f.web, { name: "web", dependencies: { missing: "*" } });
	await assert.rejects(
		pruneRuntimeDependencies(f.root),
		/Missing runtime dependency web → missing/,
	);
	for (const path of f.omitted) await access(path);
});
