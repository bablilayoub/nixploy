import type Docker from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { environments, mounts, ports } from "../../db/schema";
import { getSwarmNetwork, resolveFileMountPath } from "../application/paths";
import { mergeNodeConstraint } from "../cluster/placement";
import { getServerSwarmNodeId } from "../cluster/swarm-node";
import type { DeploymentContext } from "./context";
import { getDocker } from "./docker";
import { envToArray, mergeEnv } from "./env";
import type { ApplicationRow } from "./sources";

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

/**
 * Placement for a service: the user's `placementSwarm` with the pinned
 * server's `node.id==<swarmNodeId>` constraint merged in. The image is
 * built on that server and its volumes/file mounts live there, so the task
 * must be scheduled on it; unpinned services (`serverId` null) keep the
 * user's placement untouched.
 */
export function withNodeConstraint(
	placement: Docker.Placement | null | undefined,
	swarmNodeId: string | null | undefined,
): Docker.Placement | undefined {
	if (!swarmNodeId) return placement ?? undefined;
	return {
		...(placement ?? {}),
		Constraints: mergeNodeConstraint(placement?.Constraints, swarmNodeId),
	};
}

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

export interface ContainerSpecInput {
	imageTag: string;
	env: string[];
	mounts: Docker.MountSettings[];
	command: string | null;
	healthCheck: Docker.HealthConfig | null;
}

/**
 * Build the service ContainerSpec with explicit empties. `undefined` values
 * are dropped by JSON serialization and the engine then keeps the OLD value
 * on service update — so clearing a custom command, every env var, or a
 * healthcheck must send `[]`/`null`, not omit the key.
 */
export function buildContainerSpec(input: ContainerSpecInput): Docker.ContainerSpec {
	return {
		Image: input.imageTag,
		Env: input.env,
		Mounts: input.mounts,
		Command: input.command ? ["/bin/sh", "-c", input.command] : null,
		HealthCheck: input.healthCheck,
	} as unknown as Docker.ContainerSpec;
}

export interface UpsertSwarmServiceOptions {
	/**
	 * PR preview variant: runs the parent's image/env under `<app>-pr-<n>`
	 * but must never share its published ports, volumes or host mounts.
	 */
	preview?: boolean;
}

type MountRow = Pick<
	typeof mounts.$inferSelect,
	"type" | "volumeName" | "filePath" | "hostPath" | "mountPath"
>;
type PortRow = Pick<
	typeof ports.$inferSelect,
	"protocol" | "publishedPort" | "targetPort" | "publishMode"
>;

/**
 * Mount and port specs for a service. Preview variants get NONE of the
 * parent's: a published port would collide with production on the ingress
 * network (Swarm rejects the service), a named volume would let the PR
 * build write into production data, and file/bind mounts resolve under the
 * preview appName where nothing was materialized (`CreateHostPath` would
 * bind an empty directory). Mirrors what `cloneSwarmService` strips.
 */
export function buildRuntimeSpecs(
	appName: string,
	applicationMounts: MountRow[],
	applicationPorts: PortRow[],
	options: UpsertSwarmServiceOptions = {},
): { mounts: Docker.MountSettings[]; ports: Docker.PortConfig[] } {
	if (options.preview) return { mounts: [], ports: [] };

	const mountSpecs: Docker.MountSettings[] = applicationMounts.map(
		(mount): Docker.MountSettings => {
			if (mount.type === "volume") {
				return { Type: "volume", Source: mount.volumeName ?? "", Target: mount.mountPath };
			}
			const source =
				mount.type === "file"
					? resolveFileMountPath(appName, mount.filePath ?? "")
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

	return { mounts: mountSpecs, ports: portSpecs };
}

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
	options: UpsertSwarmServiceOptions = {},
): Promise<void> {
	// Swarm service objects live on the PRIMARY manager: managed servers join
	// its swarm (usually as workers, whose engines reject service-level
	// calls). The build ran on ctx.serverId; the placement constraint below
	// sends the task there, where the image is.
	const docker = await getDocker();
	await ensureSwarmNetwork(docker);
	const swarmNodeId = ctx.serverId ? await getServerSwarmNodeId(ctx.serverId) : null;

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

	const { mounts: mountSpecs, ports: portSpecs } = buildRuntimeSpecs(
		application.appName,
		applicationMounts,
		applicationPorts,
		options,
	);

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
			ContainerSpec: buildContainerSpec({
				imageTag,
				env,
				mounts: mountSpecs,
				command: application.command,
				healthCheck: (application.healthCheckSwarm as Docker.HealthConfig | null) ?? null,
			}),
			Resources: {
				Limits: Object.keys(limits).length > 0 ? limits : undefined,
				Reservations: Object.keys(reservations).length > 0 ? reservations : undefined,
			},
			RestartPolicy:
				(application.restartPolicySwarm as Docker.TaskRestartPolicy | null) ?? undefined,
			Placement: withNodeConstraint(
				application.placementSwarm as Docker.Placement | null,
				swarmNodeId,
			),
			Networks: sanitizeNetworkAttachments(application.networkSwarm),
		},
		// Previews are throwaway single replicas; the parent's mode/replica
		// overrides (global mode, N replicas) are production sizing.
		Mode: options.preview
			? { Replicated: { Replicas: 1 } }
			: ((application.modeSwarm as Docker.ServiceMode | null) ?? {
					Replicated: { Replicas: application.replicas },
				}),
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
