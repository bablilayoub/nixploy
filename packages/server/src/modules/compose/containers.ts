import { execAsync, execAsyncRemote } from "../../utils/exec";

export type ComposeContainerRow = {
	id: string;
	name: string;
	service: string | null;
	state: string;
	status: string;
	image: string;
};

type DockerPsRow = {
	ID: string;
	Names: string;
	State: string;
	Status: string;
	Image: string;
	Labels?: string;
};

function parseJsonLines<T>(output: string): T[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

/** Extract a compose/stack service name from docker ps Labels (comma k=v list). */
function serviceFromLabels(labels: string | undefined): string | null {
	if (!labels) return null;
	for (const part of labels.split(",")) {
		const eq = part.indexOf("=");
		if (eq <= 0) continue;
		const key = part.slice(0, eq);
		const value = part.slice(eq + 1);
		if (key === "com.docker.compose.service" || key === "com.docker.swarm.service.name") {
			return value || null;
		}
	}
	return null;
}

/**
 * Display service label: prefer compose service; for swarm strip `<appName>_` prefix.
 */
function displayService(appName: string, labels: string | undefined, names: string): string | null {
	const fromLabels = serviceFromLabels(labels);
	if (fromLabels) {
		if (fromLabels.startsWith(`${appName}_`)) return fromLabels.slice(appName.length + 1);
		return fromLabels;
	}
	// Fallback: <appName>-<service>-<n> or <appName>_<service>.…
	const name = names.split(",")[0]?.replace(/^\//, "") ?? "";
	const dash = name.match(new RegExp(`^${escapeRegExp(appName)}-([^-]+)`));
	if (dash?.[1]) return dash[1];
	const under = name.match(new RegExp(`^${escapeRegExp(appName)}_([^_.]+)`));
	if (under?.[1]) return under[1];
	return null;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shq(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function run(serverId: string | null | undefined, command: string): Promise<string> {
	return serverId ? execAsyncRemote(serverId, command) : execAsync(command);
}

/**
 * Running (+ recently created) containers belonging to a compose project /
 * swarm stack named `appName`.
 */
export async function listComposeContainers(
	appName: string,
	serverId: string | null | undefined,
): Promise<ComposeContainerRow[]> {
	const project = shq(appName);
	// Compose project label and swarm stack namespace cover both composeTypes;
	// name prefix catches oddball naming without those labels.
	const commands = [
		`docker ps -a --filter label=com.docker.compose.project=${project} --format '{{json .}}'`,
		`docker ps -a --filter label=com.docker.stack.namespace=${project} --format '{{json .}}'`,
		`docker ps -a --filter name=${project} --format '{{json .}}'`,
	];

	const chunks = await Promise.all(commands.map((command) => run(serverId, command)));
	const byId = new Map<string, ComposeContainerRow>();

	for (const chunk of chunks) {
		for (const row of parseJsonLines<DockerPsRow>(chunk)) {
			const name = (row.Names ?? "").split(",")[0]?.replace(/^\//, "") ?? row.ID;
			// Name filter is substring-ish — keep only rows that clearly belong.
			const labels = row.Labels ?? "";
			const labeled =
				labels.includes(`com.docker.compose.project=${appName}`) ||
				labels.includes(`com.docker.stack.namespace=${appName}`);
			const named =
				name === appName || name.startsWith(`${appName}-`) || name.startsWith(`${appName}_`);
			if (!labeled && !named) continue;

			byId.set(row.ID, {
				id: row.ID,
				name,
				service: displayService(appName, row.Labels, row.Names),
				state: row.State,
				status: row.Status,
				image: row.Image,
			});
		}
	}

	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether a docker inspect payload (or label map + name) belongs to `appName`.
 */
export function containerBelongsToApp(input: {
	appName: string;
	name?: string | null;
	labels?: Record<string, string> | null;
}): boolean {
	const { appName } = input;
	const labels = input.labels ?? {};
	if (labels["com.docker.compose.project"] === appName) return true;
	if (labels["com.docker.stack.namespace"] === appName) return true;
	const swarm = labels["com.docker.swarm.service.name"];
	if (swarm === appName || swarm?.startsWith(`${appName}_`)) return true;
	const name = (input.name ?? "").replace(/^\//, "");
	return name === appName || name.startsWith(`${appName}-`) || name.startsWith(`${appName}_`);
}

/** Confirm a container ID is part of the given compose/stack project. */
export async function assertComposeContainerOwnership(
	appName: string,
	containerId: string,
	serverId: string | null | undefined,
): Promise<void> {
	const id = shq(containerId);
	const format =
		'{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.stack.namespace"}}|{{index .Config.Labels "com.docker.swarm.service.name"}}';
	const out = (await run(serverId, `docker inspect --format ${shq(format)} ${id}`)).trim();
	if (!out) {
		throw new Error(`Container not found: ${containerId}`);
	}
	const [name, composeProject, stackNs, swarmService] = out.split("|");
	const ok = containerBelongsToApp({
		appName,
		name,
		labels: {
			"com.docker.compose.project": composeProject ?? "",
			"com.docker.stack.namespace": stackNs ?? "",
			"com.docker.swarm.service.name": swarmService ?? "",
		},
	});
	if (!ok) {
		throw new Error(`Container ${containerId} does not belong to "${appName}"`);
	}
}
