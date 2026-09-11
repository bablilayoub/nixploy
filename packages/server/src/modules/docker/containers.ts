import Docker from "dockerode";

/**
 * Local container lookups shared by the websocket handlers and the modules
 * that need them. Moved out of `ws/docker.ts` so nothing under `modules/`
 * imports the transport layer (audit F5); `ws/docker.ts` re-exports these
 * under their original names.
 */

let dockerInstance: Docker | null = null;

/** Local dockerode client (daemon socket on the Nixploy host). */
export function getLocalDocker(): Docker {
	if (!dockerInstance) {
		dockerInstance = new Docker();
	}
	return dockerInstance;
}

/**
 * Resolve a running container for an app on the local daemon.
 * Prefer exact Swarm / compose labels — never substring `name=` matching.
 */
export async function resolveLocalContainer(appName: string): Promise<Docker.Container | null> {
	const docker = getLocalDocker();
	const labelFilters = [
		[`com.docker.swarm.service.name=${appName}`],
		[`com.docker.compose.project=${appName}`],
		[`com.docker.stack.namespace=${appName}`],
	];
	for (const label of labelFilters) {
		const matches = await docker.listContainers({ filters: { label } });
		const first = matches[0];
		if (first) return docker.getContainer(first.Id);
	}
	return null;
}
