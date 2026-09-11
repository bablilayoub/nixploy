import type Docker from "dockerode";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { domains, environments, mounts, ports } from "../../db/schema";
import type { PrivilegesSwarm } from "../../utils/swarm-overrides";
import { getSwarmNetwork, resolveFileMountPath } from "../application/paths";
import { mergeNodeConstraint } from "../cluster/placement";
import { getServerSwarmNodeId } from "../cluster/swarm-node";
import { getQuotaResourceDefaults, type QuotaResourceDefaults } from "../projects/quotas";
import type { DeploymentContext } from "./context";
import { getDocker } from "./docker";
import { envToArray, mergeEnv } from "./env";
import { ensureEnvironmentNetwork, INTERNAL_NETWORK_NAME, isPlatformNetwork } from "./network";
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

/** Which overlays a tenant service belongs on. See `deployment/network.ts`. */
export interface TenantNetworkContext {
	/** Private per-environment overlay; every service of the env joins it. */
	environmentNetwork: string;
	/**
	 * Join the shared `nixploy-network` so Traefik can dial the service. True
	 * only for services that are actually routed (≥ 1 domain, or a preview).
	 */
	shared: boolean;
}

/**
 * Network attachments for a tenant swarm service: always the environment's
 * private overlay, `nixploy-network` only when the service is routed, plus
 * any extra platform (`nixploy-*`) overlay the instance admin listed in
 * `networkSwarm`.
 *
 * Two targets can never come from the override list, whoever asks:
 * `nixploy-network` (derived from the domains — a service with no route must
 * not be able to put itself next to Traefik and every other tenant) and
 * `nixploy-internal` (the panel ↔ Postgres overlay, which no tenant workload
 * may ever join).
 */
export function sanitizeNetworkAttachments(
	raw: unknown,
	context: TenantNetworkContext,
): Docker.NetworkAttachmentConfig[] {
	const shared = getSwarmNetwork();
	const attachments: Docker.NetworkAttachmentConfig[] = [{ Target: context.environmentNetwork }];
	if (context.shared) attachments.push({ Target: shared });
	// Seeded with the two networks an override must never be able to name.
	const seen = new Set<string>([context.environmentNetwork, shared, INTERNAL_NETWORK_NAME]);
	if (!Array.isArray(raw)) return attachments;
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const target = (entry as { Target?: unknown }).Target;
		if (typeof target !== "string" || !isPlatformNetwork(target)) continue;
		if (seen.has(target)) continue;
		seen.add(target);
		attachments.push(entry as Docker.NetworkAttachmentConfig);
	}
	return attachments;
}

/**
 * Whether the application is routed through Traefik, i.e. has at least one
 * non-preview domain. Preview domains belong to the `<app>-pr-<n>` services,
 * which attach to the shared overlay on their own.
 */
export async function applicationHasDomain(applicationId: string): Promise<boolean> {
	const [row] = await db
		.select({ value: count() })
		.from(domains)
		.where(and(eq(domains.applicationId, applicationId), isNull(domains.previewDeploymentId)));
	return (row?.value ?? 0) > 0;
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

/* -------------------------------------------------------------------------- */
/*  Container hardening defaults                                              */
/* -------------------------------------------------------------------------- */

/**
 * Baseline hardening applied to every tenant workload (applications,
 * databases and — in compose shape — compose stacks).
 *
 * Docker's default capability set is ~14 caps wide and includes `NET_RAW`
 * (ARP/DNS spoofing on a shared L2), `SETPCAP`, `MKNOD` and `AUDIT_WRITE`.
 * We drop everything and add back only what standard images need to start:
 * dropping privileges (`gosu`/`su-exec` → SETUID/SETGID), fixing ownership
 * of a fresh data volume (CHOWN/FOWNER/DAC_OVERRIDE), binding :80/:443
 * inside the container (NET_BIND_SERVICE) and signalling children (KILL).
 *
 * Verified on a local swarm with `traefik/whoami`, `nginx:alpine`,
 * `postgres:17`, `mysql:9`, `mariadb:11`, `redis:8-alpine` and
 * `louislam/uptime-kuma`: all start, initialise their data dir and serve.
 */
export const DEFAULT_CAPABILITY_DROP: readonly string[] = ["ALL"];
export const DEFAULT_CAPABILITY_ADD: readonly string[] = [
	"CHOWN",
	"DAC_OVERRIDE",
	"FOWNER",
	"KILL",
	"NET_BIND_SERVICE",
	"SETGID",
	"SETUID",
];

/** `no-new-privileges`: a setuid binary inside the container cannot re-gain caps. */
export const DEFAULT_PRIVILEGES = { NoNewPrivileges: true } as const;

/** Fork-bomb ceiling (`TaskTemplate.Resources.Limits.Pids`). */
export const DEFAULT_PIDS_LIMIT = 1024;

/** File-descriptor ceiling; `nofile` is the one limit images routinely blow. */
export const DEFAULT_NOFILE_ULIMIT = 65536;

/**
 * Log rotation for tenant tasks. `docker service logs` (and the panel's log
 * viewer) needs json-file or journald, and an unbounded json-file fills the
 * host disk — the platform services have carried these options since the
 * installer was written, tenant services did not.
 */
export const DEFAULT_LOG_DRIVER = {
	Name: "json-file",
	Options: { "max-size": "10m", "max-file": "3" },
} as const;

/** `ContainerSpec.Ulimits` entries the engine accepts (API ≥ 1.45). */
export const defaultUlimits = (): Array<{ Name: string; Soft: number; Hard: number }> => [
	{ Name: "nofile", Soft: DEFAULT_NOFILE_ULIMIT, Hard: DEFAULT_NOFILE_ULIMIT },
];

export interface ContainerSpecInput {
	imageTag: string;
	env: string[];
	mounts: Docker.MountSettings[];
	command: string | null;
	healthCheck: Docker.HealthConfig | null;
	/** Validated `application.privilegesSwarm` — merged over the hardening baseline. */
	privileges?: PrivilegesSwarm | null;
}

/**
 * Merge the instance-admin override over the baseline. The engine expects
 * bare capability names; the override schema already refuses `CAP_`.
 */
export function resolveContainerPrivileges(override: PrivilegesSwarm | null | undefined): {
	CapabilityAdd: string[];
	CapabilityDrop: string[];
	Privileges: Record<string, unknown>;
} {
	const add = new Set<string>(DEFAULT_CAPABILITY_ADD);
	for (const cap of override?.capabilityAdd ?? []) add.add(cap);
	const drop = override?.capabilityDrop?.length
		? [...override.capabilityDrop]
		: [...DEFAULT_CAPABILITY_DROP];
	const securityOpt = override?.securityOpt ?? [];
	const privileges: Record<string, unknown> = {
		NoNewPrivileges: !securityOpt.includes("no-new-privileges:false"),
	};
	if (securityOpt.includes("seccomp=unconfined")) privileges.Seccomp = { Mode: "unconfined" };
	if (securityOpt.includes("apparmor=unconfined")) privileges.AppArmor = { Mode: "disabled" };
	return { CapabilityAdd: [...add], CapabilityDrop: drop, Privileges: privileges };
}

/**
 * Build the service ContainerSpec with explicit empties. `undefined` values
 * are dropped by JSON serialization and the engine then keeps the OLD value
 * on service update — so clearing a custom command, every env var, or a
 * healthcheck must send `[]`/`null`, not omit the key.
 *
 * The hardening keys are written explicitly for the same reason **and** so a
 * live spec that grew `Privileges` / `CapabilityAdd` out of band (a manual
 * `docker service update`) is reset on the next deploy instead of surviving
 * the merge in {@link upsertSwarmService}.
 */
export function buildContainerSpec(input: ContainerSpecInput): Docker.ContainerSpec {
	const hardening = resolveContainerPrivileges(input.privileges);
	return {
		Image: input.imageTag,
		Env: input.env,
		Mounts: input.mounts,
		Command: input.command ? ["/bin/sh", "-c", input.command] : null,
		HealthCheck: input.healthCheck,
		CapabilityAdd: hardening.CapabilityAdd,
		CapabilityDrop: hardening.CapabilityDrop,
		Privileges: hardening.Privileges,
		Ulimits: defaultUlimits(),
	} as unknown as Docker.ContainerSpec;
}

/**
 * `TaskTemplate.Resources` for a tenant service: the row's explicit limits
 * win, the org quota fills the blanks, and `Pids` is always capped.
 */
export function buildTaskResources(
	limits: Docker.ResourceLimits,
	reservations: Docker.ResourceRequirements["Reservations"],
	defaults: QuotaResourceDefaults = {},
	pidsLimit: number | null | undefined = undefined,
): Docker.ResourceRequirements {
	const merged: Docker.ResourceLimits & { Pids?: number } = { ...limits };
	if (merged.MemoryBytes === undefined && defaults.memoryBytes !== undefined) {
		merged.MemoryBytes = defaults.memoryBytes;
	}
	if (merged.NanoCPUs === undefined && defaults.nanoCpus !== undefined) {
		merged.NanoCPUs = defaults.nanoCpus;
	}
	merged.Pids = pidsLimit ?? DEFAULT_PIDS_LIMIT;
	return {
		Limits: merged,
		Reservations: reservations && Object.keys(reservations).length > 0 ? reservations : undefined,
	};
}

/** Resource defaults derived from the org quota of an environment's project. */
export async function loadQuotaDefaults(
	organizationId: string | null | undefined,
): Promise<QuotaResourceDefaults> {
	if (!organizationId) return {};
	return getQuotaResourceDefaults(organizationId);
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
/** Default budget for a rollout to produce one running task. */
export const DEFAULT_CONVERGENCE_TIMEOUT_MS = 180_000;
const CONVERGENCE_POLL_MS = 2_000;

export function convergenceTimeoutMs(): number {
	const raw = Number(process.env.NIXPLOY_CONVERGENCE_TIMEOUT_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONVERGENCE_TIMEOUT_MS;
}

type TaskLike = {
	Status?: { State?: string; Err?: string; Message?: string };
	DesiredState?: string;
	CreatedAt?: string;
};

/**
 * Decide from one task listing whether the rollout has converged. `running`
 * only appears once a HEALTHCHECK (when the image has one) passed, so this is
 * also the health gate. Three consecutive failed/rejected tasks mean the
 * image cannot start — surface the engine's reason instead of waiting out
 * the whole budget.
 */
export function assessConvergence(
	tasks: TaskLike[],
): { state: "running" } | { state: "failed"; reason: string } | { state: "pending" } {
	if (tasks.some((task) => task.Status?.State === "running")) return { state: "running" };
	const recent = [...tasks]
		.sort((a, b) => (b.CreatedAt ?? "").localeCompare(a.CreatedAt ?? ""))
		.slice(0, 3);
	if (
		recent.length === 3 &&
		recent.every((task) => task.Status?.State === "failed" || task.Status?.State === "rejected")
	) {
		const reason = recent[0]?.Status?.Err || recent[0]?.Status?.Message || "task failed";
		return { state: "failed", reason };
	}
	return { state: "pending" };
}

/**
 * Wait until the service has at least one running task. Throws when the
 * tasks keep failing or the budget (`NIXPLOY_CONVERGENCE_TIMEOUT_MS`) runs
 * out, so a deployment is only `done` once the new version actually serves.
 */
export async function waitForServiceConvergence(
	appName: string,
	options: { timeoutMs?: number; log?: (line: string) => void } = {},
): Promise<void> {
	const docker = await getDocker();
	const deadline = Date.now() + (options.timeoutMs ?? convergenceTimeoutMs());
	let lastReason = "no task reached the running state";
	while (Date.now() < deadline) {
		const tasks = (await docker
			.listTasks({ filters: { service: [appName], "desired-state": ["running"] } })
			.catch(() => [])) as TaskLike[];
		const verdict = assessConvergence(tasks);
		if (verdict.state === "running") return;
		if (verdict.state === "failed") {
			throw new Error(`Service ${appName} failed to start: ${verdict.reason}`);
		}
		const pending = tasks[0]?.Status?.State;
		if (pending) lastReason = `last task state: ${pending}`;
		await new Promise((resolve) => setTimeout(resolve, CONVERGENCE_POLL_MS));
	}
	throw new Error(
		`Service ${appName} did not converge within ${Math.round(
			(options.timeoutMs ?? convergenceTimeoutMs()) / 1000,
		)}s (${lastReason})`,
	);
}

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

	const [applicationMounts, applicationPorts, environment, routed] = await Promise.all([
		db.query.mounts.findMany({ where: eq(mounts.applicationId, application.applicationId) }),
		db.query.ports.findMany({ where: eq(ports.applicationId, application.applicationId) }),
		db.query.environments.findFirst({
			where: eq(environments.environmentId, application.environmentId),
			with: { project: true },
		}),
		// A preview always carries its own generated domain.
		options.preview ? Promise.resolve(true) : applicationHasDomain(application.applicationId),
	]);
	if (!environment) {
		throw new Error(`Environment ${application.environmentId} not found`);
	}

	// Private per-environment overlay; the shared one only when Traefik routes here.
	const environmentNetwork = await ensureEnvironmentNetwork(environment);
	const quotaDefaults = await loadQuotaDefaults(environment.project.organizationId);

	// Env inheritance: project → environment → service (service wins).
	const mergedEnv = mergeEnv(environment.project.env, environment.env, application.env);
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
				privileges: application.privilegesSwarm as PrivilegesSwarm | null,
			}),
			Resources: buildTaskResources(
				limits,
				reservations,
				quotaDefaults,
				(application.privilegesSwarm as PrivilegesSwarm | null)?.pidsLimit,
			),
			RestartPolicy:
				(application.restartPolicySwarm as Docker.TaskRestartPolicy | null) ?? undefined,
			Placement: withNodeConstraint(
				application.placementSwarm as Docker.Placement | null,
				swarmNodeId,
			),
			Networks: sanitizeNetworkAttachments(application.networkSwarm, {
				environmentNetwork,
				shared: routed,
			}),
			LogDriver: { ...DEFAULT_LOG_DRIVER, Options: { ...DEFAULT_LOG_DRIVER.Options } },
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
