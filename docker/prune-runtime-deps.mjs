import { readdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

// These peers expose schema generation, type checking and test helpers. None
// is imported by the panel, worker, encryption rotator or runtime migrator.
// A production install still includes them because pnpm installs peers. Keep
// their runtime siblings (drizzle-orm, tsx and its native esbuild) intact.
const buildPeers = new Set(["drizzle-kit", "typescript", "vitest"]);

export async function pruneRuntimeDependencies(inputRoot) {
	const root = await realpath(inputRoot);
	const store = join(root, "node_modules/.pnpm");
	const retained = new Set();
	const visited = new Set();
	const excluded = new Set();

	async function dependencyPath(directory, name) {
		// Resolve pnpm's sibling links without package exports restrictions.
		for (let current = directory; ; current = dirname(current)) {
			try {
				return await realpath(join(current, "node_modules", name));
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			if (current === root) return null;
		}
	}

	async function visit(directory) {
		if (visited.has(directory)) return;
		visited.add(directory);
		const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
		const location = relative(store, directory);
		if (!location.startsWith(`..${sep}`) && !location.startsWith(sep)) {
			retained.add(location.split(sep)[0]);
		}
		const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
		const peers = manifest.peerDependencies ?? {};
		for (const name of new Set([...Object.keys(dependencies), ...Object.keys(peers)])) {
			const peer = !(name in dependencies);
			if (buildPeers.has(name)) {
				if (!peer) throw new Error(`${manifest.name} requires build tool ${name} at runtime`);
				excluded.add(name);
				continue;
			}
			const target = await dependencyPath(directory, name);
			if (target) {
				if (relative(root, target).startsWith(`..${sep}`)) {
					throw new Error(`Dependency ${name} resolves outside the runtime tree`);
				}
				await visit(target);
			} else if (!(name in (manifest.optionalDependencies ?? {})) && !peer) {
				throw new Error(`Missing runtime dependency ${manifest.name} → ${name}`);
			}
		}
	}

	await visit(join(root, "apps/web"));
	await visit(join(root, "packages/server"));
	let removed = 0;
	for (const entry of await readdir(store, { withFileTypes: true })) {
		if (entry.isDirectory() && entry.name !== "node_modules" && !retained.has(entry.name)) {
			await rm(join(store, entry.name), { recursive: true });
			removed++;
		}
	}
	// Install metadata and root development command shims are not runtime APIs.
	await rm(join(store, "lock.yaml"), { force: true });
	await rm(join(root, "node_modules/.bin"), { recursive: true, force: true });
	console.info(
		`Runtime dependencies: ${retained.size} retained, ${removed} omitted; build peers: ${[...excluded].sort().join(", ")}`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await pruneRuntimeDependencies(resolve(process.argv[2] ?? "/app"));
}
