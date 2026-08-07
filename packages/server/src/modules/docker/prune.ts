import { PROTECTED_VOLUMES } from "./protected";

type Run = (command: string) => Promise<string>;

function parseJsonLines<T>(output: string): T[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

function shq(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Volume names currently referenced by any container (running or stopped). */
async function listInUseVolumeNames(run: Run): Promise<Set<string>> {
	const ids = (await run("docker ps -aq")).trim();
	if (!ids) return new Set();
	const quoted = ids.split(/\s+/).filter(Boolean).map(shq).join(" ");
	const mounts = await run(
		`docker inspect ${quoted} --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{println}}{{end}}{{end}}'`,
	);
	const names = new Set<string>();
	for (const line of mounts.split("\n")) {
		const name = line.trim();
		if (name) names.add(name);
	}
	return names;
}

/**
 * Remove unused local volumes, including named ones.
 *
 * Docker 23+ `volume prune` only deletes anonymous volumes unless `-a` is
 * passed; we also skip Nixploy platform volumes even if nothing mounts them.
 */
export async function pruneUnusedVolumes(run: Run): Promise<string> {
	const inUse = await listInUseVolumeNames(run);
	const listed = parseJsonLines<{ Name: string }>(
		await run(`docker volume ls --format '{{json .}}'`),
	);

	const removed: string[] = [];
	const skippedProtected: string[] = [];

	for (const row of listed) {
		const name = row.Name;
		if (!name || inUse.has(name)) continue;
		if (PROTECTED_VOLUMES.has(name)) {
			skippedProtected.push(name);
			continue;
		}
		try {
			await run(`docker volume rm ${shq(name)}`);
			removed.push(name);
		} catch {
			// Container raced into using it, or driver refused — leave it.
		}
	}

	const lines = [
		"Deleted Volumes:",
		...(removed.length > 0 ? removed.map((name) => name) : ["(none)"]),
	];
	if (skippedProtected.length > 0) {
		lines.push(`Skipped protected: ${skippedProtected.join(", ")}`);
	}
	lines.push(`Total: ${removed.length} volume(s)`);
	return `${lines.join("\n")}\n`;
}
