import type Docker from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { environments, mounts, ports } from "../../db/schema";
import { resolveFileMountPath } from "../application/paths";
import type { DeploymentContext } from "./context";
import { getDocker } from "./docker";
import { envToArray, mergeEnv } from "./env";
import type { ApplicationRow } from "./sources";

/** Attachable overlay network every swarm service joins (Traefik routing). */
export const getSwarmNetwork = (): string => process.env.NIXPLOY_NETWORK ?? "nixploy-network";

/** Drop Traefik/hijack labels from user-supplied swarm label maps. */
export function sanitizeSwarmLabels(raw: unknown): Record<string, string> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!key || key.toLowerCase().startsWith("traefik.")) continue;
		if (typeof value === "string") out[key] = value;
		else if (value != null) out[key] = String(value);
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Only allow the shared overlay (plus explicit attachable targets named nixploy-*). */
export function sanitizeNetworkAttachments(raw: unknown): Docker.NetworkAttachmentConfig[] {
	const fallback: Docker.NetworkAttachmentConfig[] = [{ Target: getSwarmNetwork() }];
	if (!Array.isArray(raw) || raw.length === 0) return fallback;
	const allowed = raw.filter((entry): entry is Docker.NetworkAttachmentConfig => {
		if (!entry || typeof entry !== "object") return false;
		const target = (entry as { Target?: unknown }).Target;
		return (
			typeof target === "string" && (target === getSwarmNetwork() || target.startsWith("nixploy-"))
		);
	});
	return allowed.length > 0 ? allowed : fallback;
}

/** Parse `"512m"` / `"1g"` / `"1024"` (bytes) into bytes. */
const parseMemoryBytes = (value: string | null): number | undefined => {
	if (!value) return undefined;
	const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)b?\s*$/i.exec(value);
	if (!match?.[1]) return undefined;
	const amount = Number.parseFloat(match[1]);
	const multiplier = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[
		(match[2] ?? "").toLowerCase()
	];
	return multiplier === undefined ? undefined : Math.floor(amount * multiplier);
};

/** Parse `"0.5"` / `"2"` cpus into Docker NanoCPUs. */
const parseCpuNano = (value: string | null): number | undefined => {
	if (!value) return undefined;
	const cpus = Number.parseFloat(value);
	if (Number.isNaN(cpus) || cpus <= 0) return undefined;
	return Math.floor(cpus * 1e9);
};

/** Create the shared overlay network when missing (fresh swarm installs). */
async function ensureSwarmNetwork(docker: Docker): Promise<void> {
	const name = getSwarmNetwork();
	try {
		await docker.getNetwork(name).inspect();
	} catch {
		await docker.createNetwork({ Name: name, Driver: "overlay", Attachable: true });
	}
}

const isNotFound = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	(error as { statusCode?: number }).statusCode === 404;

/**
 * Create or update the application's swarm service from the current DB
 * state (env, mounts, ports, resources, replicas, raw swarm overrides)
 * pinned to `imageTag`. Updates roll start-first with a stop-first
 * rollback config; published ports go through the routing mesh.
 */
export async function upsertSwarmService(
	ctx: DeploymentContext,
	application: ApplicationRow,
	imageTag: string,
): Promise<void> {
	const docker = await getDocker(ctx.serverId);
	await ensureSwarmNetwork(docker);

	const [applicationMounts, applicationPorts, environment] = await Promise.all([
		db.query.mounts.findMany({ where: eq(mounts.applicationId, application.applicationId) }),
		db.query.ports.findMany({ where: eq(ports.applicationId, application.applicationId) }),
		db.query.environments.findFirst({
			where: eq(environments.environmentId, application.environmentId),
			with: { project: true },
		}),
	]);

	// Env inheritance: project → environment → service (service wins).
	const mergedEnv = mergeEnv(environment?.project.env, environment?.env, application.env);
	const env = envToArray(mergedEnv);

	const mountSpecs: Docker.MountSettings[] = applicationMounts.map(
		(mount): Docker.MountSettings => {
			if (mount.type === "volume") {
				return { Type: "volume", Source: mount.volumeName ?? "", Target: mount.mountPath };
			}
			const source =
				mount.type === "file"
					? resolveFileMountPath(application.appName, mount.filePath ?? "")
					: (mount.hostPath ?? "");
			return {
				Type: "bind",
				Source: source,
				Target: mount.mountPath,
				ReadOnly: mount.type === "file",
				// CreateHostPath is valid for the engine but missing from the
				// @types/dockerode BindOptions shape.
				BindOptions: { CreateHostPath: true } as unknown as Docker.MountSettings["BindOptions"],
			};
		},
	);

	const portSpecs: Docker.PortConfig[] = applicationPorts.map((port) => ({
		Protocol: port.protocol,
		PublishedPort: port.publishedPort,
		TargetPort: port.targetPort,
		PublishMode: port.publishMode,
	}));

	const limits: Docker.ResourceLimits = {};
	const memoryLimit = parseMemoryBytes(application.memoryLimit);
	const cpuLimit = parseCpuNano(application.cpuLimit);
	if (memoryLimit) limits.MemoryBytes = memoryLimit;
	if (cpuLimit) limits.NanoCPUs = cpuLimit;

	const reservations: Docker.ResourceRequirements["Reservations"] = {};
	const memoryReservation = parseMemoryBytes(application.memoryReservation);
	const cpuReservation = parseCpuNano(application.cpuReservation);
	if (memoryReservation) reservations.MemoryBytes = memoryReservation;
	if (cpuReservation) reservations.NanoCPUs = cpuReservation;

	const spec: Docker.ServiceSpec = {
		Name: application.appName,
		Labels: sanitizeSwarmLabels(application.labelsSwarm),
		TaskTemplate: {
			ContainerSpec: {
				Image: imageTag,
				Env: env.length > 0 ? env : undefined,
				Mounts: mountSpecs.length > 0 ? mountSpecs : undefined,
				Command: application.command ? ["/bin/sh", "-c", application.command] : undefined,
				HealthCheck: (application.healthCheckSwarm as Docker.HealthConfig | null) ?? undefined,
			},
			Resources: {
				Limits: Object.keys(limits).length > 0 ? limits : undefined,
				Reservations: Object.keys(reservations).length > 0 ? reservations : undefined,
			},
			RestartPolicy:
				(application.restartPolicySwarm as Docker.TaskRestartPolicy | null) ?? undefined,
			Placement: (application.placementSwarm as Docker.Placement | null) ?? undefined,
			Networks: sanitizeNetworkAttachments(application.networkSwarm),
		},
		Mode: (application.modeSwarm as Docker.ServiceMode | null) ?? {
			Replicated: { Replicas: application.replicas },
		},
		UpdateConfig: (application.updateConfigSwarm as Docker.UpdateConfig | null) ?? {
			Parallelism: 1,
			Order: "start-first",
		},
		RollbackConfig: (application.rollbackConfigSwarm as Docker.UpdateConfig | null) ?? {
			Parallelism: 1,
			Order: "stop-first",
		},
		EndpointSpec: portSpecs.length > 0 ? { Mode: "vip", Ports: portSpecs } : { Mode: "vip" },
	};

	const service = docker.getService(application.appName);
	let current: Docker.Service | null = null;
	try {
		current = (await service.inspect()) as Docker.Service;
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}

	if (!current) {
		ctx.logger.line(`Creating swarm service ${application.appName}...`);
		await docker.createService(spec);
		return;
	}

	ctx.logger.line(`Updating swarm service ${application.appName}...`);
	const currentTask = current.Spec?.TaskTemplate as Docker.ContainerTaskSpec | undefined;
	const newImage = (spec.TaskTemplate as Docker.ContainerTaskSpec | undefined)?.ContainerSpec
		?.Image;
	const merged: Docker.ServiceSpec = {
		...current.Spec,
		...spec,
		TaskTemplate: {
			...currentTask,
			...spec.TaskTemplate,
			ContainerSpec: {
				...currentTask?.ContainerSpec,
				...(spec.TaskTemplate as Docker.ContainerTaskSpec | undefined)?.ContainerSpec,
			},
			// Same-tag redeploys: the spec is otherwise identical, so the swarm
			// would no-op and keep the OLD image running. Bump ForceUpdate to
			// force task recreation whenever the tag didn't change.
			ForceUpdate:
				newImage != null && newImage === currentTask?.ContainerSpec?.Image
					? (currentTask?.ForceUpdate ?? 0) + 1
					: (currentTask?.ForceUpdate ?? 0),
		},
	};
	await service.update({ version: current.Version?.Index ?? 0, ...merged });
}
