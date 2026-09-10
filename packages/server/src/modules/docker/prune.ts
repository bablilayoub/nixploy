import { isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { compose, mariadb, mongo, mounts, mysql, postgres, redis } from "../../db/schema";
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

function namesFromLines(output: string): Set<string> {
	const names = new Set<string>();
	for (const line of output.split("\n")) {
		const name = line.trim();
		if (name) names.add(name);
	}
	return names;
}

/** Volume names currently referenced by any container (running or stopped). */
async function listInUseVolumeNames(run: Run): Promise<Set<string>> {
	const ids = (await run("docker ps -aq")).trim();
	if (!ids) return new Set();
	const quoted = ids.split(/\s+/).filter(Boolean).map(shq).join(" ");
	return namesFromLines(
		await run(
			`docker inspect ${quoted} --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{println}}{{end}}{{end}}'`,
		),
	);
}

/**
 * Volume names mounted by Swarm services. Nixploy "stop" scales services to
 * zero, so a stopped database has no container at all — its data volume only
 * shows up here. Empty on hosts that are not Swarm managers.
 */
async function listSwarmServiceVolumeNames(run: Run): Promise<Set<string>> {
	try {
		const ids = (await run("docker service ls -q")).trim();
		if (!ids) return new Set();
		const quoted = ids.split(/\s+/).filter(Boolean).map(shq).join(" ");
		return namesFromLines(
			await run(
				`docker service inspect ${quoted} --format '{{range .Spec.TaskTemplate.ContainerSpec.Mounts}}{{if eq .Type "volume"}}{{.Source}}{{println}}{{end}}{{end}}'`,
			),
		);
	} catch {
		// Worker node (no manager API) or no swarm — nothing to protect here.
		return new Set();
	}
}

export interface ServiceVolumeGuard {
	/** Exact volume names owned by Nixploy service rows. */
	names: Set<string>;
	/** Prefixes (`<composeAppName>_`) of compose/stack-managed named volumes. */
	prefixes: string[];
}

/**
 * Volumes that Nixploy database rows still reference, regardless of whether a
 * container mounts them right now: `<appName>-data` for every database
 * service, explicit `mounts.volumeName` entries, and the `<appName>_*`
 * family compose/stack projects create. Deleting any of these would destroy
 * a service's data the moment it is stopped.
 */
export async function listServiceVolumeGuard(): Promise<ServiceVolumeGuard> {
	const [pg, my, maria, mongoRows, redisRows, composeRows, mountRows] = await Promise.all([
		db.select({ appName: postgres.appName }).from(postgres),
		db.select({ appName: mysql.appName }).from(mysql),
		db.select({ appName: mariadb.appName }).from(mariadb),
		db.select({ appName: mongo.appName }).from(mongo),
		db.select({ appName: redis.appName }).from(redis),
		db.select({ appName: compose.appName }).from(compose),
		db.select({ volumeName: mounts.volumeName }).from(mounts).where(isNotNull(mounts.volumeName)),
	]);
	const names = new Set<string>();
	for (const row of [...pg, ...my, ...maria, ...mongoRows, ...redisRows]) {
		if (row.appName) names.add(`${row.appName}-data`);
	}
	for (const row of mountRows) {
		if (row.volumeName) names.add(row.volumeName);
	}
	const prefixes = composeRows.map((row) => `${row.appName}_`).filter((p) => p.length > 1);
	return { names, prefixes };
}

/** Whether a volume name is claimed by a Nixploy platform or service row. */
export function isGuardedVolumeName(name: string, guard?: ServiceVolumeGuard | null): boolean {
	if (PROTECTED_VOLUMES.has(name)) return true;
	if (!guard) return false;
	if (guard.names.has(name)) return true;
	return guard.prefixes.some((prefix) => name.startsWith(prefix));
}

/**
 * Remove unused local volumes, including named ones.
 *
 * Docker 23+ `volume prune` only deletes anonymous volumes unless `-a` is
 * passed; we also skip Nixploy platform volumes, volumes any Swarm service
 * mounts, and volumes Nixploy service rows own (`guard`) even if nothing
 * mounts them right now.
 *
 * `run` targets the host whose volumes are pruned; `runOnPrimary` (defaults
 * to `run`) reads the Swarm service specs, which only exist on the primary
 * manager — a managed server is usually a worker with no service API.
 */
export async function pruneUnusedVolumes(
	run: Run,
	guard?: ServiceVolumeGuard | null,
	runOnPrimary: Run = run,
): Promise<string> {
	const [inUse, swarmMounted, listed] = await Promise.all([
		listInUseVolumeNames(run),
		listSwarmServiceVolumeNames(runOnPrimary),
		run(`docker volume ls --format '{{json .}}'`).then(parseJsonLines<{ Name: string }>),
	]);

	const removed: string[] = [];
	const skippedProtected: string[] = [];

	for (const row of listed) {
		const name = row.Name;
		if (!name || inUse.has(name)) continue;
		if (swarmMounted.has(name) || isGuardedVolumeName(name, guard)) {
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
