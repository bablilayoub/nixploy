import fs from "node:fs/promises";
import path from "node:path";
import type Docker from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	domains,
	mounts,
	ports,
	previewDeployments,
	redirects,
	security,
} from "../../db/schema";
import { assertSafeAppName, assertSafePublishedPort } from "../../utils/validators";
import { removeServiceLogs } from "../deployment/maintenance";
import { sanitizeNetworkAttachments, sanitizeSwarmLabels } from "../deployment/swarm";
import { deletePreviewDeployment } from "../preview";
import { removeTraefikConfig, writeAppTraefikConfig } from "../traefik";
import { generateAppName, isAppNameTaken } from "./app-name";
import type { ServiceInspectInfo } from "./docker";
import { getDocker, inspectSwarmService, removeSwarmService, scaleSwarmService } from "./docker";
import { getApplicationDir, resolveFileMountPath } from "./paths";

export type Application = typeof applications.$inferSelect;

/** Default container port when a domain row does not specify one. */
const DEFAULT_CONTAINER_PORT = 3000;

/* -------------------------------------------------------------------------- */
/*  Parsing helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Parse a dotenv string into Docker's `KEY=VALUE` env array. */
export const parseDotEnv = (env: string | null): string[] => {
	if (!env) return [];
	return env
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#") && line.includes("="));
};

/** Parse `"512m"` / `"1g"` / `"1024"` (bytes) into bytes. */
export const parseMemoryBytes = (value: string | null): number | undefined => {
	if (!value) return undefined;
	const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)b?\s*$/i.exec(value);
	if (!match?.[1]) return undefined;
	const amount = Number.parseFloat(match[1]);
	const unit = (match[2] ?? "").toLowerCase();
	const multiplier =
		unit === "k"
			? 1024
			: unit === "m"
				? 1024 ** 2
				: unit === "g"
					? 1024 ** 3
					: unit === "t"
						? 1024 ** 4
						: 1;
	return Math.floor(amount * multiplier);
};

/** Parse `"0.5"` / `"2"` cpus into Docker NanoCPUs. */
export const parseCpuNano = (value: string | null): number | undefined => {
	if (!value) return undefined;
	const cpus = Number.parseFloat(value);
	if (Number.isNaN(cpus) || cpus <= 0) return undefined;
	return Math.floor(cpus * 1e9);
};

/* -------------------------------------------------------------------------- */
/*  File mounts                                                               */
/* -------------------------------------------------------------------------- */

/** Write (or overwrite) the host file backing a `file` mount. */
export const materializeFileMount = async (
	appName: string,
	filePath: string,
	content: string,
): Promise<void> => {
	const absolute = resolveFileMountPath(appName, filePath);
	await fs.mkdir(path.dirname(absolute), { recursive: true });
	await fs.writeFile(absolute, content, "utf8");
};

/** Remove the host file backing a `file` mount (best effort). */
export const removeFileMount = async (appName: string, filePath: string): Promise<void> => {
	try {
		await fs.rm(resolveFileMountPath(appName, filePath), { force: true });
	} catch {
		// best effort
	}
};

/* -------------------------------------------------------------------------- */
/*  Swarm service spec                                                        */
/* -------------------------------------------------------------------------- */

type ApplicationRow = Pick<
	Application,
	| "applicationId"
	| "appName"
	| "env"
	| "replicas"
	| "command"
	| "dockerImage"
	| "memoryReservation"
	| "memoryLimit"
	| "cpuReservation"
	| "cpuLimit"
	| "healthCheckSwarm"
	| "restartPolicySwarm"
	| "placementSwarm"
	| "updateConfigSwarm"
	| "rollbackConfigSwarm"
	| "modeSwarm"
	| "labelsSwarm"
	| "networkSwarm"
	| "serverId"
>;

const buildSwarmSpec = (
	application: ApplicationRow,
	applicationMounts: Array<typeof mounts.$inferSelect>,
	applicationPorts: Array<typeof ports.$inferSelect>,
	image: string,
): Docker.ServiceSpec => {
	const env = parseDotEnv(application.env);

	const mountSpecs: Docker.MountSettings[] = applicationMounts.map(
		(mount): Docker.MountSettings => {
			if (mount.type === "volume") {
				return {
					Type: "volume",
					Source: mount.volumeName ?? "",
					Target: mount.mountPath,
				};
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
				// CreateHostPath exists in the Docker API but is missing from
				// dockerode's BindOptions typing.
				BindOptions: { CreateHostPath: true } as unknown as Docker.MountSettings["BindOptions"],
			};
		},
	);

	const portSpecs: Docker.PortConfig[] = applicationPorts.map((port) => {
		assertSafePublishedPort(port.publishedPort);
		return {
			Protocol: port.protocol,
			PublishedPort: port.publishedPort,
			TargetPort: port.targetPort,
			PublishMode: port.publishMode,
		};
	});

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

	return {
		Name: application.appName,
		Labels: sanitizeSwarmLabels(application.labelsSwarm),
		TaskTemplate: {
			ContainerSpec: {
				Image: image,
				Env: env.length > 0 ? env : undefined,
				Mounts: mountSpecs.length > 0 ? mountSpecs : undefined,
				Command: application.command ? ["/bin/sh", "-c", application.command] : undefined,
				// The Engine API field is `Healthcheck`; dockerode's typings
				// (incorrectly) call it `HealthCheck`.
				...({
					Healthcheck: (application.healthCheckSwarm as Docker.HealthConfig | null) ?? undefined,
				} as Partial<Docker.ContainerSpec>),
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
};

/**
 * Create or update the swarm service for an application from the current
 * DB state (env, mounts, ports, resources, replicas). No-op when the app
 * has never been deployed and carries no `dockerImage` — the deploy
 * engine owns the first rollout.
 */
export const upsertApplicationSwarmService = async (application: ApplicationRow): Promise<void> => {
	const docker = await getDocker(application.serverId);
	const service = docker.getService(application.appName);

	const [applicationMounts, applicationPorts] = await Promise.all([
		db.query.mounts.findMany({ where: eq(mounts.applicationId, application.applicationId) }),
		db.query.ports.findMany({ where: eq(ports.applicationId, application.applicationId) }),
	]);

	let current: ServiceInspectInfo | null = null;
	try {
		current = (await service.inspect()) as ServiceInspectInfo;
	} catch (error) {
		if (
			!(
				typeof error === "object" &&
				error !== null &&
				(error as { statusCode?: number }).statusCode === 404
			)
		) {
			throw error;
		}
	}

	const currentContainerSpec = (current?.Spec?.TaskTemplate as Docker.ContainerTaskSpec | undefined)
		?.ContainerSpec;

	const image = currentContainerSpec?.Image ?? application.dockerImage ?? null;
	if (!image) {
		// Never deployed and no docker image: nothing to upsert yet.
		return;
	}

	const spec = buildSwarmSpec(application, applicationMounts, applicationPorts, image);

	if (!current) {
		await docker.createService(spec);
		return;
	}

	const merged: Docker.ServiceSpec = {
		...current.Spec,
		...spec,
		TaskTemplate: {
			...current.Spec?.TaskTemplate,
			...spec.TaskTemplate,
			ContainerSpec: {
				...currentContainerSpec,
				...(spec.TaskTemplate as Docker.ContainerTaskSpec | undefined)?.ContainerSpec,
			},
		},
	};
	await service.update({ version: current.Version?.Index, ...merged });
};

/* -------------------------------------------------------------------------- */
/*  Traefik                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Re-write the Traefik dynamic config for an application from the current
 * domains/redirects/security rows. Call after every routing-affecting
 * mutation.
 */
export const syncApplicationTraefik = async (
	application: Pick<Application, "applicationId" | "appName" | "serverId">,
): Promise<void> => {
	const [appDomains, appRedirects, appSecurity] = await Promise.all([
		db.query.domains.findMany({
			where: eq(domains.applicationId, application.applicationId),
		}),
		db.query.redirects.findMany({
			where: eq(redirects.applicationId, application.applicationId),
		}),
		db.query.security.findMany({
			where: eq(security.applicationId, application.applicationId),
		}),
	]);

	await writeAppTraefikConfig({
		appName: application.appName,
		serverId: application.serverId,
		domains: appDomains
			.filter((domain) => domain.domainType !== "preview" && !domain.previewDeploymentId)
			.map((domain) => ({
				host: domain.host,
				port: domain.port ?? DEFAULT_CONTAINER_PORT,
				path: domain.path,
				https: domain.https,
				certificateType: domain.certificateType,
				certificateId: domain.certificateId,
			})),
		redirects: appRedirects.map((redirect) => ({
			regex: redirect.regex,
			replacement: redirect.replacement,
			permanent: redirect.permanent,
		})),
		basicAuth: appSecurity.map((entry) => ({
			username: entry.username,
			// bcrypt hash (decrypted by the column); Traefik users-file format.
			password: entry.password,
		})),
	});
};

/* -------------------------------------------------------------------------- */
/*  CRUD + lifecycle                                                          */
/* -------------------------------------------------------------------------- */

export interface CreateApplicationInput {
	name: string;
	description?: string | null;
	environmentId: string;
	appName?: string;
	serverId?: string | null;
}

export const createApplication = async (input: CreateApplicationInput): Promise<Application> => {
	const appName = input.appName
		? assertSafeAppName(input.appName)
		: await generateAppName(input.name);
	if (await isAppNameTaken(appName)) {
		throw new Error(`appName "${appName}" is already in use`);
	}

	const [application] = await db
		.insert(applications)
		.values({
			name: input.name,
			description: input.description ?? null,
			appName,
			environmentId: input.environmentId,
			serverId: input.serverId ?? null,
			buildType: "nixpacks",
			sourceType: "git",
			replicas: 1,
		})
		.returning();
	if (!application) {
		throw new Error("Failed to create application");
	}
	return application;
};

export const updateApplication = async (
	applicationId: string,
	data: Partial<typeof applications.$inferInsert>,
): Promise<Application> => {
	const [application] = await db
		.update(applications)
		.set(data)
		.where(eq(applications.applicationId, applicationId))
		.returning();
	if (!application) {
		throw new Error(`Application not found: ${applicationId}`);
	}
	return application;
};

/**
 * Clone an application row into `environmentId` with a fresh appName and
 * status `idle`: all config (source, build, resources, env) plus its mounts
 * and published ports. Domains, redirects, basic-auth and deployments are NOT
 * copied (hosts would collide; history belongs to the source).
 */
export const duplicateApplication = async (
	source: Application,
	environmentId: string,
): Promise<Application> => {
	const appName = await generateAppName(source.name);
	const {
		applicationId: sourceId,
		createdAt: _createdAt,
		status: _status,
		appName: _appName,
		...rest
	} = source;
	const [created] = await db
		.insert(applications)
		.values({ ...rest, appName, environmentId, status: "idle" })
		.returning();
	if (!created) {
		throw new Error("Failed to duplicate application");
	}

	const sourceMounts = await db.query.mounts.findMany({
		where: eq(mounts.applicationId, sourceId),
	});
	if (sourceMounts.length > 0) {
		await db.insert(mounts).values(
			sourceMounts.map((mount) => ({
				type: mount.type,
				hostPath: mount.hostPath,
				volumeName: mount.volumeName,
				filePath: mount.filePath,
				content: mount.content,
				mountPath: mount.mountPath,
				serviceType: "application" as const,
				applicationId: created.applicationId,
			})),
		);
	}

	const sourcePorts = await db.query.ports.findMany({
		where: eq(ports.applicationId, sourceId),
	});
	if (sourcePorts.length > 0) {
		await db.insert(ports).values(
			sourcePorts.map((port) => ({
				publishedPort: port.publishedPort,
				targetPort: port.targetPort,
				protocol: port.protocol,
				publishMode: port.publishMode,
				applicationId: created.applicationId,
			})),
		);
	}

	return created;
};

/**
 * Delete an application: tear down its PR preview deployments, remove the
 * swarm service (local or remote), drop its Traefik config, wipe on-disk
 * state, then delete the row (mounts, ports, domains, deployments... cascade).
 */
export const deleteApplication = async (
	application: Pick<Application, "applicationId" | "appName" | "serverId">,
): Promise<void> => {
	const previews = await db.query.previewDeployments.findMany({
		where: eq(previewDeployments.applicationId, application.applicationId),
	});
	await Promise.all(
		previews.map((preview) =>
			deletePreviewDeployment(preview.previewDeploymentId).catch((error) => {
				console.error(
					`Failed to remove preview deployment ${preview.appName}:`,
					error instanceof Error ? error.message : error,
				);
			}),
		),
	);

	await removeSwarmService(application.appName, application.serverId).catch(() => {
		// service may never have been deployed
	});
	await removeTraefikConfig(application.appName, application.serverId);

	if (!application.serverId) {
		await fs.rm(getApplicationDir(application.appName), { recursive: true, force: true });
	}
	// Build logs live outside the app dir and have no FK to cascade through.
	await removeServiceLogs(application.appName).catch(() => {});

	await db.delete(applications).where(eq(applications.applicationId, application.applicationId));
};

/** Start a stopped application by scaling back to its configured replicas. */
export const startApplication = async (
	application: Pick<Application, "applicationId" | "appName" | "replicas" | "serverId">,
): Promise<void> => {
	const service = await inspectSwarmService(application.appName, application.serverId);
	if (!service) {
		throw new Error("Application has not been deployed yet — deploy it first");
	}
	await scaleSwarmService(application.appName, application.replicas || 1, application.serverId);
	await updateApplication(application.applicationId, { status: "running" });
};

/** Stop an application by scaling its swarm service to 0. */
export const stopApplication = async (
	application: Pick<Application, "applicationId" | "appName" | "serverId">,
): Promise<void> => {
	// Never-deployed apps have no service to scale; the row still flips to idle.
	if (await inspectSwarmService(application.appName, application.serverId)) {
		await scaleSwarmService(application.appName, 0, application.serverId);
	}
	await updateApplication(application.applicationId, { status: "idle" });
};

/** Store the service-level dotenv string (encrypted at rest by the column). */
export const saveEnvironment = async (
	applicationId: string,
	env: string,
	buildArgs?: string | null,
): Promise<Application> =>
	updateApplication(applicationId, {
		env,
		...(buildArgs !== undefined ? { buildArgs } : {}),
	});
