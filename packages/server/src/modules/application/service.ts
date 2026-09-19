import fs from "node:fs/promises";
import path from "node:path";
import type Docker from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	domains,
	environments,
	mounts,
	ports,
	previewDeployments,
	redirects,
	security,
} from "../../db/schema";

import { bestEffort } from "../../utils/best-effort";
import type { PrivilegesSwarm } from "../../utils/swarm-overrides";
import { assertSafeAppName, assertSafePublishedPort } from "../../utils/validators";
import { unregisterBackupsForService } from "../backups/scheduler";
import { getServerSwarmNodeId } from "../cluster/swarm-node";
import { envToArray, mergeEnv } from "../deployment/env";
import { removeServiceLogs } from "../deployment/maintenance";
import { ensureEnvironmentNetwork, pruneEnvironmentNetwork } from "../deployment/network";
import {
	applicationHasDomain,
	buildContainerSpec,
	buildTaskResources,
	DEFAULT_LOG_DRIVER,
	loadQuotaDefaults,
	sanitizeNetworkAttachments,
	sanitizeSwarmLabels,
	withNodeConstraint,
} from "../deployment/swarm";
import { invalidateDockerListings } from "../docker/containers";
import { conflict, notFound, preconditionFailed } from "../errors";
import { deletePreviewDeployment } from "../preview";
import type { QuotaResourceDefaults } from "../projects/quotas";
import { removeRuntimeLogs } from "../runtime-logs/store";
import { unregisterSchedulesForService } from "../schedules";
import { generateAppName, isAppNameTaken } from "../services/app-name";
import {
	removeFileOnServer,
	removeTraefikConfig,
	toTraefikDomainEntry,
	writeAppTraefikConfig,
	writeFileOnServer,
} from "../traefik";
import type { ServiceInspectInfo } from "./docker";
import {
	getDocker,
	inspectSwarmService,
	reloadSwarmService,
	removeApplicationImages,
	removeSwarmService,
	scaleSwarmService,
} from "./docker";
import { getApplicationDir, getSwarmNetwork, resolveFileMountPath } from "./paths";

export type Application = typeof applications.$inferSelect;

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

/**
 * Write (or overwrite) the host file backing a `file` mount — on the Nixploy
 * host, or on the managed server the application is pinned to (the bind
 * source must exist where the task runs; the deploy engine never writes it).
 */
export const materializeFileMount = async (
	appName: string,
	filePath: string,
	content: string,
	serverId?: string | null,
): Promise<void> => {
	const absolute = resolveFileMountPath(appName, filePath);
	if (serverId) {
		await writeFileOnServer(absolute, content, serverId);
		return;
	}
	await fs.mkdir(path.dirname(absolute), { recursive: true });
	// 0600: `file` mounts are `secrets.write`-gated user content (TLS keys,
	// app config with credentials) and used to land world-readable on the host
	// (security audit 2.4). `chmod` as well, so existing files are tightened.
	await fs.writeFile(absolute, content, { encoding: "utf8", mode: 0o600 });
	await fs.chmod(absolute, 0o600).catch(() => {
		// Best effort on filesystems without POSIX modes.
	});
};

/** Remove the host file backing a `file` mount (best effort). */
export const removeFileMount = async (
	appName: string,
	filePath: string,
	serverId?: string | null,
): Promise<void> => {
	try {
		const absolute = resolveFileMountPath(appName, filePath);
		if (serverId) {
			await removeFileOnServer(absolute, serverId);
			return;
		}
		await fs.rm(absolute, { force: true });
	} catch {
		// best effort
	}
};

/** Materialize every `file` mount row of an application on its target server. */
export const materializeFileMounts = async (
	application: Pick<Application, "applicationId" | "appName" | "serverId">,
): Promise<void> => {
	const rows = await db.query.mounts.findMany({
		where: eq(mounts.applicationId, application.applicationId),
	});
	for (const mount of rows) {
		if (mount.type !== "file" || !mount.filePath) continue;
		await materializeFileMount(
			application.appName,
			mount.filePath,
			mount.content ?? "",
			application.serverId,
		);
	}
};

/* -------------------------------------------------------------------------- */
/*  Swarm service spec                                                        */
/* -------------------------------------------------------------------------- */

type ApplicationRow = Pick<
	Application,
	| "applicationId"
	| "appName"
	| "environmentId"
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
	| "privilegesSwarm"
	| "serverId"
>;

/**
 * Fully merged runtime env of an application: project → environment →
 * service (service wins) — the same inheritance the deploy engine applies.
 * Building the spec from the app's own vars alone silently dropped every
 * project/environment-level variable on the next port/mount/env edit.
 */
export const loadMergedApplicationEnv = async (
	application: Pick<Application, "environmentId" | "env">,
): Promise<string[]> => {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, application.environmentId),
		with: { project: true },
	});
	return envToArray(mergeEnv(environment?.project.env, environment?.env, application.env));
};

export interface ApplicationSwarmSpecOptions {
	/**
	 * Primary-swarm node id of the server the application is pinned to
	 * (`getServerSwarmNodeId`); merged into the placement as `node.id==…`.
	 */
	swarmNodeId?: string | null;
	/** Private per-environment overlay (see `deployment/network.ts`). */
	environmentNetwork: string;
	/** Join `nixploy-network` — true only when Traefik routes to the service. */
	routed: boolean;
	/** Per-service `Resources.Limits` fallbacks derived from the org quota. */
	quotaDefaults?: QuotaResourceDefaults;
}

/**
 * Swarm service spec from DB state. The ContainerSpec carries explicit
 * empties (`Env: []`, `Command: null`, ...): `undefined` keys vanish in
 * JSON and the engine then keeps the OLD value on update — or, when spread
 * over the current spec, the key is simply lost.
 */
export const buildApplicationSwarmSpec = (
	application: ApplicationRow,
	applicationMounts: Array<
		Pick<typeof mounts.$inferSelect, "type" | "volumeName" | "filePath" | "hostPath" | "mountPath">
	>,
	applicationPorts: Array<
		Pick<typeof ports.$inferSelect, "protocol" | "publishedPort" | "targetPort" | "publishMode">
	>,
	image: string,
	env: string[],
	options: ApplicationSwarmSpecOptions,
): Docker.ServiceSpec => {
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
				BindOptions: {
					CreateHostPath: true,
				} as unknown as Docker.MountSettings["BindOptions"],
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
			ContainerSpec: buildContainerSpec({
				imageTag: image,
				env,
				mounts: mountSpecs,
				command: application.command,
				healthCheck: (application.healthCheckSwarm as Docker.HealthConfig | null) ?? null,
				privileges: application.privilegesSwarm as PrivilegesSwarm | null,
			}),
			Resources: buildTaskResources(
				limits,
				reservations,
				options.quotaDefaults,
				(application.privilegesSwarm as PrivilegesSwarm | null)?.pidsLimit,
			),
			RestartPolicy:
				(application.restartPolicySwarm as Docker.TaskRestartPolicy | null) ?? undefined,
			Placement: withNodeConstraint(
				application.placementSwarm as Docker.Placement | null,
				options.swarmNodeId,
			),
			Networks: sanitizeNetworkAttachments(application.networkSwarm, {
				environmentNetwork: options.environmentNetwork,
				shared: options.routed,
			}),
			LogDriver: { ...DEFAULT_LOG_DRIVER, Options: { ...DEFAULT_LOG_DRIVER.Options } },
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
	// Service objects live on the primary manager; the pinned server only
	// shows up as a placement constraint (see application/docker.ts).
	const docker = await getDocker();
	const service = docker.getService(application.appName);

	const [applicationMounts, applicationPorts, env, swarmNodeId, environment, routed] =
		await Promise.all([
			db.query.mounts.findMany({
				where: eq(mounts.applicationId, application.applicationId),
			}),
			db.query.ports.findMany({
				where: eq(ports.applicationId, application.applicationId),
			}),
			loadMergedApplicationEnv(application),
			application.serverId ? getServerSwarmNodeId(application.serverId) : null,
			db.query.environments.findFirst({
				where: eq(environments.environmentId, application.environmentId),
				with: { project: true },
			}),
			applicationHasDomain(application.applicationId),
		]);
	if (!environment) throw notFound(`Environment not found: ${application.environmentId}`);
	const environmentNetwork = await ensureEnvironmentNetwork(environment);
	const quotaDefaults = await loadQuotaDefaults(environment.project.organizationId);

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

	const spec = buildApplicationSwarmSpec(
		application,
		applicationMounts,
		applicationPorts,
		image,
		env,
		{ swarmNodeId, environmentNetwork, routed, quotaDefaults },
	);

	if (!current) {
		await docker.createService(spec);
		return;
	}

	// Every key of `spec` is explicit (see buildApplicationSwarmSpec), so the
	// spread only preserves engine-managed fields such as ForceUpdate.
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
 * Keep the live service's `nixploy-network` membership in sync with its
 * domains.
 *
 * Applications only join the shared, Traefik-facing overlay while they are
 * actually routed (see `deployment/network.ts`), and domains are added and
 * removed long after the deploy that built the spec — so the first domain has
 * to attach the network and the last one removed has to detach it, or Traefik
 * answers 502 / the service lingers next to every other tenant.
 *
 * A never-deployed service is skipped; the next deploy builds the right spec.
 * Attaching rolls the tasks (start-first), which is the same cost as any
 * other spec change.
 */
export const syncApplicationSharedNetwork = async (
	application: Pick<Application, "applicationId" | "appName">,
): Promise<void> => {
	const docker = await getDocker();
	const service = docker.getService(application.appName);
	const current = (await service.inspect().catch(() => null)) as ServiceInspectInfo | null;
	if (!current?.Spec?.TaskTemplate) return;

	const sharedName = getSwarmNetwork();
	const sharedId = await docker
		.getNetwork(sharedName)
		.inspect()
		.then((network: { Id?: string }) => network.Id ?? null)
		.catch(() => null);

	const task = current.Spec.TaskTemplate as Docker.ContainerTaskSpec;
	const networks = (task.Networks ?? []) as Docker.NetworkAttachmentConfig[];
	const isShared = (entry: Docker.NetworkAttachmentConfig) =>
		entry.Target === sharedName || (sharedId != null && entry.Target === sharedId);

	const routed = await applicationHasDomain(application.applicationId);
	if (networks.some(isShared) === routed) return;

	const next = routed
		? [...networks, { Target: sharedName }]
		: networks.filter((entry) => !isShared(entry));
	await service.update({
		version: current.Version?.Index,
		...current.Spec,
		TaskTemplate: { ...task, Networks: next },
	});
};

/**
 * Re-write the Traefik dynamic config for an application from the current
 * domains/redirects/security rows. Call after every routing-affecting
 * mutation. The YAML always lands on the Nixploy host, whatever server the
 * app is pinned to — that is where `nixploy-traefik` reads it.
 */
export const syncApplicationTraefik = async (
	application: Pick<Application, "applicationId" | "appName">,
): Promise<void> => {
	const [appDomains, appRedirects, appSecurity] = await Promise.all([
		db.query.domains.findMany({
			where: eq(domains.applicationId, application.applicationId),
			with: { middlewares: true },
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
		domains: appDomains
			.filter((domain) => domain.domainType !== "preview" && !domain.previewDeploymentId)
			// One mapper for every routing column (protocol/entrypoint/tlsMode
			// included) — a hand-written literal here silently dropped new fields.
			.map(toTraefikDomainEntry),
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

	// The route only works if Traefik can reach the backend: the first domain
	// attaches the shared overlay, the last one removed detaches it again.
	await bestEffort(`sync shared network for ${application.appName}`, () =>
		syncApplicationSharedNetwork(application),
	);
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
		throw conflict(`appName "${appName}" is already in use`);
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
		throw notFound(`Application not found: ${applicationId}`);
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
		// File mounts bind `<files dir>/<newAppName>/<filePath>`: the rows alone
		// leave that path missing and the first deploy binds an empty directory.
		await materializeFileMounts(created);
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
 * Delete an application: cancel its in-process cron jobs, tear down its PR
 * preview deployments, remove the swarm service (local or remote) and its
 * images, drop its Traefik config, wipe on-disk state, then delete the row
 * (mounts, ports, domains, deployments... cascade).
 */
export const deleteApplication = async (
	application: Pick<Application, "applicationId" | "appName" | "serverId" | "environmentId">,
): Promise<void> => {
	// Schedules and backups are node-schedule jobs held in memory: the row
	// cascade never reaches them, so a job firing after the delete would exec
	// into a container that no longer exists (and keep failing every tick).
	unregisterSchedulesForService({
		applicationId: application.applicationId,
		appName: application.appName,
	});
	unregisterBackupsForService({
		appName: application.appName,
		applicationId: application.applicationId,
	});

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

	await removeSwarmService(application.appName).catch(() => {
		// service may never have been deployed
	});
	// Built images + rollback pins are not swept by the (dangling-only) cleanup
	// cron. Image-level: they live on the server the app was built on.
	await bestEffort(`remove images for ${application.appName}`, () =>
		removeApplicationImages(application.appName, application.serverId),
	);
	await removeTraefikConfig(application.appName);

	if (!application.serverId) {
		await fs.rm(getApplicationDir(application.appName), {
			recursive: true,
			force: true,
		});
	}
	// Build logs live outside the app dir and have no FK to cascade through.
	await bestEffort(`remove logs for ${application.appName}`, () =>
		removeServiceLogs(application.appName),
	);
	await bestEffort(`remove runtime logs for ${application.appName}`, () =>
		removeRuntimeLogs(application.appName),
	);

	await db.delete(applications).where(eq(applications.applicationId, application.applicationId));

	// The environment overlay outlives its services; `network rm` refuses one
	// that still has endpoints, so this only lands when the last one left.
	await pruneEnvironmentNetwork(application.environmentId);
};

/** Start a stopped application by scaling back to its configured replicas. */
export const startApplication = async (
	application: Pick<Application, "applicationId" | "appName" | "replicas" | "serverId">,
): Promise<void> => {
	const service = await inspectSwarmService(application.appName);
	if (!service) {
		throw preconditionFailed("Application has not been deployed yet — deploy it first");
	}
	await scaleSwarmService(application.appName, application.replicas || 1);
	// What runs on that server just changed: drop the Docker tab's listing cache
	// so it does not keep showing the stopped state for up to one TTL window.
	invalidateDockerListings(application.serverId);
	await updateApplication(application.applicationId, { status: "running" });
};

/** Stop an application by scaling its swarm service to 0. */
export const stopApplication = async (
	application: Pick<Application, "applicationId" | "appName" | "serverId">,
): Promise<void> => {
	// Never-deployed apps have no service to scale; the row still flips to idle.
	if (await inspectSwarmService(application.appName)) {
		await scaleSwarmService(application.appName, 0);
	}
	invalidateDockerListings(application.serverId);
	await updateApplication(application.applicationId, { status: "idle" });
};

/**
 * Force-restart every task (`docker service update --force`) and flip the row
 * back to `running`. Lives here, not in the router, so the Docker listing cache
 * is dropped on every transport (panel, REST, CLI, MCP).
 */
export const reloadApplication = async (
	application: Pick<Application, "applicationId" | "appName" | "serverId">,
): Promise<Application> => {
	await reloadSwarmService(application.appName);
	invalidateDockerListings(application.serverId);
	return updateApplication(application.applicationId, { status: "running" });
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
