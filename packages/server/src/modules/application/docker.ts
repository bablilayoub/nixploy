import Docker from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { servers } from "../../db/schema";
import { verifyRemoteHostKey } from "../../utils/exec";

/**
 * Docker/Swarm operations against the local host or a remote managed
 * server. Local goes through the docker socket; remote servers are
 * reached with dockerode's SSH transport using the server's SSH key
 * (same trust model as `execAsyncRemote`).
 */
export const getDocker = async (serverId?: string | null): Promise<Docker> => {
	if (!serverId) {
		const socketPath = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
		return new Docker({ socketPath });
	}

	const server = await db.query.servers.findFirst({
		where: eq(servers.serverId, serverId),
		with: { sshKey: true },
	});
	if (!server) {
		throw new Error(`Server not found: ${serverId}`);
	}
	if (!server.sshKey) {
		throw new Error(`Server ${server.name} (${serverId}) has no SSH key attached`);
	}

	return new Docker({
		protocol: "ssh",
		host: server.ipAddress,
		port: server.port,
		username: server.username,
		sshOptions: {
			host: server.ipAddress,
			port: server.port,
			username: server.username,
			privateKey: server.sshKey.privateKey,
			hostVerifier: (key: Buffer) => verifyRemoteHostKey(serverId, key),
		},
	});
};

const isNotFound = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"statusCode" in error &&
	(error as { statusCode?: number }).statusCode === 404;

/**
 * Result of inspecting a swarm service. dockerode's typings merge the
 * `Service` client class with the inspect-info interface, so
 * `Docker.Service` carries `Spec`, `Version`, `Endpoint`, ...
 */
export type ServiceInspectInfo = Docker.Service;

/** Inspect a swarm service by name; `null` when it does not exist. */
export const inspectSwarmService = async (
	appName: string,
	serverId?: string | null,
): Promise<ServiceInspectInfo | null> => {
	const docker = await getDocker(serverId);
	try {
		return await docker.getService(appName).inspect();
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
};

/** Remove a swarm service; no-op when it does not exist. */
export const removeSwarmService = async (
	appName: string,
	serverId?: string | null,
): Promise<void> => {
	const docker = await getDocker(serverId);
	try {
		await docker.getService(appName).remove();
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
};

/**
 * Untag every locally built image of a service: `appName:latest` plus the
 * `appName:<version>` rollback pins. Images pulled for docker-source apps
 * carry their own repository name and are never touched. The cleanup cron
 * only prunes DANGLING images now (a full `image prune -a` deleted stopped
 * apps' only image), so without this a deleted service's images stayed on
 * disk forever. Untagging is forced so it succeeds while the service's last
 * tasks are still shutting down; the layers become dangling and are
 * reclaimed by the next cleanup pass.
 */
export const removeApplicationImages = async (
	appName: string,
	serverId?: string | null,
): Promise<void> => {
	const docker = await getDocker(serverId);
	const images = await docker.listImages({ filters: { reference: [`${appName}:*`] } });
	for (const image of images) {
		for (const tag of image.RepoTags ?? []) {
			if (!tag.startsWith(`${appName}:`)) continue;
			await docker
				.getImage(tag)
				.remove({ force: true })
				.catch(() => {
					// in use by a build, or already gone — best effort
				});
		}
	}
};

/** Scale a swarm service to `replicas` (0 = stopped). */
export const scaleSwarmService = async (
	appName: string,
	replicas: number,
	serverId?: string | null,
): Promise<void> => {
	const docker = await getDocker(serverId);
	const service = docker.getService(appName);
	const current = await service.inspect();
	const spec = current.Spec ?? {};
	spec.Mode = { Replicated: { Replicas: replicas } };
	await service.update({ version: current.Version.Index, ...spec });
};

/** Force a re-pull/restart of every task (`docker service update --force`). */
export const reloadSwarmService = async (
	appName: string,
	serverId?: string | null,
): Promise<void> => {
	const docker = await getDocker(serverId);
	const service = docker.getService(appName);
	const current = await service.inspect();
	const spec = current.Spec ?? {};
	spec.TaskTemplate = {
		...spec.TaskTemplate,
		ForceUpdate: (spec.TaskTemplate?.ForceUpdate ?? 0) + 1,
	};
	await service.update({ version: current.Version.Index, ...spec });
};

/** Point a swarm service at a different image (used by rollbacks). */
export const updateSwarmServiceImage = async (
	appName: string,
	image: string,
	serverId?: string | null,
): Promise<void> => {
	const docker = await getDocker(serverId);
	const service = docker.getService(appName);
	const current = await service.inspect();
	const spec = current.Spec ?? {};
	spec.TaskTemplate = {
		...spec.TaskTemplate,
		ContainerSpec: { ...spec.TaskTemplate?.ContainerSpec, Image: image },
	};
	await service.update({ version: current.Version.Index, ...spec });
};

/**
 * Create a copy of a running service under a new name (used by preview
 * deployments). Published ports are stripped so the variant never
 * collides with the parent on the ingress network.
 */
export const cloneSwarmService = async (
	sourceAppName: string,
	targetAppName: string,
	serverId?: string | null,
): Promise<void> => {
	const docker = await getDocker(serverId);
	const current = await inspectSwarmService(sourceAppName, serverId);
	if (!current?.Spec) {
		throw new Error(`Swarm service "${sourceAppName}" does not exist`);
	}
	const existing = await inspectSwarmService(targetAppName, serverId);
	if (existing) {
		await docker.getService(targetAppName).remove();
	}
	const { Name: _name, ...spec } = current.Spec;
	await docker.createService({
		...spec,
		Name: targetAppName,
		TaskTemplate: {
			...spec.TaskTemplate,
			ForceUpdate: 0,
		},
		Mode: { Replicated: { Replicas: 1 } },
		EndpointSpec: { Mode: spec.EndpointSpec?.Mode ?? "vip" },
	});
};
