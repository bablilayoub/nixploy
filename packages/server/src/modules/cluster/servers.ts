import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { servers, webServerSettings } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { getSwarmNetwork } from "../application/paths";
import { installRemoteBuilderCommand, REMOTE_BUILDER_TOOLS } from "../deployment/builders/tools";
import { shellQuote } from "../deployment/paths";
import { forbidden, notFound, preconditionFailed } from "../errors";
import { REMOTE_TRAEFIK_DIR } from "../traefik/paths";
import { buildTraefikStaticConfig } from "../traefik/setup";
import { inspectPrimaryNode } from "./swarm-node";

export type SwarmRole = "worker" | "manager";

export type CreateServerInput = {
	name: string;
	description?: string | null;
	ipAddress: string;
	port?: number;
	username?: string;
	sshKeyId?: string | null;
	swarmRole?: SwarmRole;
};

export type UpdateServerInput = Partial<CreateServerInput> & {
	serverStatus?: "active" | "inactive";
	enableDockerCleanup?: boolean;
	metricsConfig?: Record<string, unknown>;
};

/** Strip Swarm join tokens from setup logs before API / DB exposure. */
export function redactServerCommandLog(command: string | null | undefined): string | null {
	if (!command) return command ?? null;
	return command.replace(/SWMTKN-\S+/g, "SWMTKN-***");
}

export async function findServerById(serverId: string, organizationId: string) {
	return await db.query.servers.findFirst({
		where: and(eq(servers.serverId, serverId), eq(servers.organizationId, organizationId)),
	});
}

export async function listServersByOrganization(organizationId: string) {
	return await db.query.servers.findMany({
		where: eq(servers.organizationId, organizationId),
		with: { sshKey: { columns: { sshKeyId: true, name: true } } },
		orderBy: (fields, { desc }) => [desc(fields.createdAt)],
	});
}

export async function createServer(input: CreateServerInput, organizationId: string) {
	const [server] = await db
		.insert(servers)
		.values({ ...input, organizationId })
		.returning();
	return server;
}

export async function updateServerById(
	serverId: string,
	input: UpdateServerInput,
	organizationId: string,
) {
	const [server] = await db
		.update(servers)
		.set(input)
		.where(and(eq(servers.serverId, serverId), eq(servers.organizationId, organizationId)))
		.returning();
	return server;
}

/** Best-effort remote command with a short timeout; never throws. */
async function tryRemote(serverId: string, command: string): Promise<string | null> {
	try {
		return (await execAsyncRemote(serverId, command, { timeoutMs: 30_000 })).trim();
	} catch {
		return null;
	}
}

/**
 * Detach a managed server: best-effort `docker swarm leave --force` on the
 * remote and `docker node rm --force` on the primary manager, then delete
 * the row. Without the leave/rm a deleted server stays an Active node of
 * the primary Swarm and keeps receiving any tenant's tasks and secrets.
 * Host errors (unreachable, already left) never block the row deletion.
 */
export async function removeServer(serverId: string, organizationId: string) {
	const existing = await findServerById(serverId, organizationId);
	if (!existing) return undefined;

	const nodeId = await tryRemote(
		serverId,
		`docker info --format '{{if eq .Swarm.LocalNodeState "active"}}{{.Swarm.NodeID}}{{end}}' 2>/dev/null`,
	);
	if (nodeId) {
		await tryRemote(serverId, "docker swarm leave --force");
		try {
			// `node rm` only succeeds once the node reports Down (or with --force).
			await execAsync(`docker node rm --force ${shellQuote(nodeId)}`, {
				timeout: 30_000,
			});
		} catch {
			// Not a manager here, node already gone, or a different swarm — ignore.
		}
	}

	const [server] = await db
		.delete(servers)
		.where(and(eq(servers.serverId, serverId), eq(servers.organizationId, organizationId)))
		.returning();
	return server;
}

/**
 * Verify SSH reachability and Docker availability on a managed server.
 * Returns the remote Docker server version on success, throws otherwise.
 */
export async function testConnection(serverId: string) {
	const pong = await execAsyncRemote(serverId, "echo ok");
	if (!pong.includes("ok")) {
		throw preconditionFailed("SSH connection failed: unexpected response to `echo ok`");
	}
	const version = await execAsyncRemote(serverId, "docker version --format '{{.Server.Version}}'");
	return { dockerVersion: version.trim() };
}

async function getLetsEncryptEmail(): Promise<string | null> {
	const [settings] = await db.select().from(webServerSettings).limit(1);
	return settings?.letsEncryptEmail ?? null;
}

/**
 * Read a swarm join token + advertise address from the primary (local) swarm.
 * Requires Swarm to already be active on the Nixploy host.
 */
export async function getPrimarySwarmJoinCommand(role: SwarmRole): Promise<string> {
	const token = (await execAsync(`docker swarm join-token ${role} -q`)).trim();
	if (!token) {
		throw preconditionFailed(`Failed to read swarm ${role} join token from the primary host`);
	}

	// Prefer the manager's advertised address from swarm info; fall back to
	// parsing the full join-token command docker prints.
	let addr = "";
	try {
		const info = await execAsync(
			`docker info --format '{{if .Swarm.NodeAddr}}{{.Swarm.NodeAddr}}{{end}}'`,
		);
		addr = info.trim();
	} catch {
		// fall through
	}
	if (!addr) {
		const full = await execAsync(`docker swarm join-token ${role}`);
		const match = full.match(/docker swarm join --token \S+ (\S+)/);
		if (match?.[1]) {
			return `docker swarm join --token ${token} ${match[1]}`;
		}
		throw preconditionFailed("Could not determine primary swarm advertise address");
	}

	const port = addr.includes(":") ? "" : ":2377";
	return `docker swarm join --token ${token} ${addr}${port}`;
}

/** Image `buildWithPack` runs on a managed server (no `pack` binary there). */
const PACK_IMAGE = "buildpacksio/pack:latest";

/** Escape hatch for air-gapped hosts: skip the GitHub release downloads. */
export const SKIP_REMOTE_BUILDERS_ENV = "NIXPLOY_SKIP_REMOTE_BUILDERS";

export interface SetupServerOptions {
	/**
	 * The caller ran `assertInstanceAdmin` for this request. Joining the
	 * primary Swarm is cluster-wide (a manager controls every tenant's
	 * services, a worker runs every org's unpinned tasks as root), so the
	 * join is refused without it — org capabilities alone are not enough.
	 */
	instanceAdminVerified: boolean;
}

/**
 * Idempotent remote provisioning of a managed server:
 * install Docker if missing, join the *primary* Swarm (worker or manager),
 * ensure the shared overlay network exists on managers. Traefik stays on the
 * primary cluster (global, manager-constrained) — remotes do not run their
 * own swarm or Traefik. Safe to re-run; the accumulated shell log is
 * persisted on the server row (`command` column).
 */
export async function setupServer(serverId: string, options: SetupServerOptions): Promise<string> {
	if (!options.instanceAdminVerified) {
		throw forbidden("Joining a server to the primary Swarm requires the instance admin");
	}
	const log: string[] = [];
	const step = async (label: string, command: string) => {
		log.push(`$ ${command}`);
		try {
			const out = await execAsyncRemote(serverId, command);
			if (out.trim()) log.push(out.trimEnd());
			return out;
		} catch (error) {
			log.push(`✖ ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}
	};

	/**
	 * Same as `step` but a failure only lands in the log. Used for the builder
	 * installs: a GitHub outage or an unsupported architecture must not undo a
	 * successful Docker install and Swarm join — the operator sees the error in
	 * the setup log and the builder itself says "run Server → Setup again".
	 */
	const optionalStep = async (label: string, command: string): Promise<boolean> => {
		try {
			await step(label, command);
			return true;
		} catch {
			return false;
		}
	};

	try {
		const server = await db.query.servers.findFirst({
			where: eq(servers.serverId, serverId),
		});
		if (!server) {
			throw notFound(`Server not found: ${serverId}`);
		}
		const role: SwarmRole = server.swarmRole === "manager" ? "manager" : "worker";

		await step("test connection", "echo ok");

		await step(
			"install docker",
			`if ! command -v docker >/dev/null 2>&1; then
  if [ "\${NIXPLOY_ALLOW_REMOTE_DOCKER_INSTALL:-0}" != "1" ]; then
    echo "Docker is not installed. Install Docker on this host, or set NIXPLOY_ALLOW_REMOTE_DOCKER_INSTALL=1 to allow curl|sh from get.docker.com." >&2
    exit 1
  fi
  curl -fsSL https://get.docker.com | sh
else
  echo "docker already installed: $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
fi`,
		);

		// Builders (product audit, Deploy #3). Nixpacks is the DEFAULT build
		// type, and `buildWithNixpacks` refuses to run on a server that does
		// not have it — a fresh remote could not build anything before this.
		// The `pack` image covers both buildpack builders (they always run
		// through the container on a remote), railpack pulls buildkit itself.
		if (process.env[SKIP_REMOTE_BUILDERS_ENV] === "1") {
			log.push(`# builder install skipped (${SKIP_REMOTE_BUILDERS_ENV}=1)`);
		} else {
			for (const tool of REMOTE_BUILDER_TOOLS) {
				const ok = await optionalStep(`install ${tool.name}`, installRemoteBuilderCommand(tool));
				log.push(
					ok
						? `# ${tool.name} ${tool.version} ready`
						: `# warning: ${tool.name} ${tool.version} was not installed — builds using it will fail on this server`,
				);
			}
			const packOk = await optionalStep("pull pack image", `docker pull ${shellQuote(PACK_IMAGE)}`);
			log.push(
				packOk
					? `# ${PACK_IMAGE} pulled`
					: `# warning: could not pull ${PACK_IMAGE} — the buildpack builders will pull it on first use`,
			);
		}

		const swarmState = (
			await execAsyncRemote(
				serverId,
				`docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo inactive`,
			)
		).trim();

		if (swarmState !== "active") {
			const joinCommand = await getPrimarySwarmJoinCommand(role);
			log.push(`# joining primary swarm as ${role}`);
			await step("swarm join", joinCommand);
		} else {
			log.push(`# swarm already active (${role} requested; left as-is)`);
		}

		// Record the node id in the PRIMARY swarm: services pinned to this
		// server are created on the primary manager with a
		// `node.id==<swarmNodeId>` placement constraint (cluster/swarm-node.ts).
		// A node the primary does not know joined some other swarm — leave the
		// column empty so deploys fail with a clear error instead of pending.
		const swarmNodeId =
			(await step("read swarm node id", `docker info --format '{{.Swarm.NodeID}}'`)).trim() || null;
		const knownToPrimary = swarmNodeId ? await inspectPrimaryNode(swarmNodeId) : null;
		if (!knownToPrimary) {
			log.push(
				`# warning: node ${swarmNodeId ?? "?"} is not part of the Nixploy host's swarm — run \`docker swarm leave --force\` on this server and re-run setup`,
			);
		}

		// Overlay networks are cluster-scoped; create from a manager if missing.
		// Workers cannot create overlay networks.
		if (role === "manager") {
			const network = getSwarmNetwork();
			await step(
				"create network",
				`if [ -z "$(docker network ls --filter name=^${network}$ --format '{{.Name}}')" ]; then docker network create --driver overlay --attachable ${network}; else echo "network ${network} already exists"; fi`,
			);

			// Managers may schedule the global Traefik service; its bind mounts
			// (traefik.yml, dynamic/, acme.json — same layout ensureTraefikSetup
			// and install.sh create on the primary) must exist on this node too.
			const traefikDir = REMOTE_TRAEFIK_DIR;
			const acmePath = `${traefikDir}/acme.json`;
			await step(
				"prepare traefik dirs",
				`mkdir -p ${shellQuote(`${traefikDir}/dynamic`)} && touch ${shellQuote(acmePath)} && chmod 600 ${shellQuote(acmePath)}`,
			);

			const staticConfig = buildTraefikStaticConfig(await getLetsEncryptEmail());
			await step(
				"write traefik static config",
				`cat > ${shellQuote(`${traefikDir}/traefik.yml`)} << 'NIXPLOY_TRAEFIK_EOF'\n${staticConfig}NIXPLOY_TRAEFIK_EOF`,
			);
		} else {
			log.push("# worker node — overlay network and Traefik stay on managers");
		}

		const command = redactServerCommandLog(log.join("\n")) ?? "";
		await db
			.update(servers)
			.set({
				command,
				serverStatus: "active",
				swarmNodeId: knownToPrimary ? swarmNodeId : null,
			})
			.where(eq(servers.serverId, serverId));
		return command;
	} catch (error) {
		const command = redactServerCommandLog(log.join("\n")) ?? "";
		await db
			.update(servers)
			.set({ command, serverStatus: "inactive" })
			.where(eq(servers.serverId, serverId));
		throw error;
	}
}

export type ServerStats = {
	dockerVersion: string;
	operatingSystem: string;
	architecture: string;
	cpus: number;
	memTotalBytes: number;
	containers: number;
	containersRunning: number;
	containersStopped: number;
	images: number;
	swarmNodeState: string;
	memory: { totalBytes: number; usedBytes: number; availableBytes: number };
	disk: {
		totalBytes: number;
		usedBytes: number;
		availableBytes: number;
		usedPercent: string;
	};
	loadAverage: [number, number, number];
};

/** Live node metrics for a managed server, collected over SSH. */
export async function getServerStats(serverId: string): Promise<ServerStats> {
	const raw = await execAsyncRemote(
		serverId,
		[
			"echo '==DOCKER=='",
			"docker info --format '{{json .}}'",
			"echo '==DF=='",
			"df -B1 / | tail -n 1",
			"echo '==MEM=='",
			"free -b | awk '/^Mem:/ {print $2, $3, $7}'",
			"echo '==LOAD=='",
			"cat /proc/loadavg",
			"echo '==CPU=='",
			"nproc",
		].join("; "),
	);

	const section = (name: string) => {
		const match = raw.match(new RegExp(`==${name}==\\n([\\s\\S]*?)(?===[A-Z]+==|$)`));
		return match?.[1]?.trim() ?? "";
	};

	const dockerInfo = JSON.parse(section("DOCKER")) as Record<string, unknown>;
	const dfParts = section("DF").split(/\s+/);
	const memParts = section("MEM").split(/\s+/).map(Number);
	const loadParts = section("LOAD").split(/\s+/);

	return {
		dockerVersion: String(dockerInfo.ServerVersion ?? ""),
		operatingSystem: String(dockerInfo.OperatingSystem ?? ""),
		architecture: String(dockerInfo.Architecture ?? ""),
		cpus: Number(section("CPU")) || Number(dockerInfo.NCPU ?? 0),
		memTotalBytes: Number(dockerInfo.MemTotal ?? 0),
		containers: Number(dockerInfo.Containers ?? 0),
		containersRunning: Number(dockerInfo.ContainersRunning ?? 0),
		containersStopped: Number(dockerInfo.ContainersStopped ?? 0),
		images: Number(dockerInfo.Images ?? 0),
		swarmNodeState: String(
			(dockerInfo.Swarm as Record<string, unknown> | undefined)?.LocalNodeState ?? "",
		),
		memory: {
			totalBytes: memParts[0] ?? 0,
			usedBytes: memParts[1] ?? 0,
			availableBytes: memParts[2] ?? 0,
		},
		disk: {
			totalBytes: Number(dfParts[1] ?? 0),
			usedBytes: Number(dfParts[2] ?? 0),
			availableBytes: Number(dfParts[3] ?? 0),
			usedPercent: dfParts[4] ?? "",
		},
		loadAverage: [Number(loadParts[0] ?? 0), Number(loadParts[1] ?? 0), Number(loadParts[2] ?? 0)],
	};
}

const STATS_CACHE_TTL_MS = 30_000;
const STATS_BATCH_CONCURRENCY = 4;

type StatsCacheEntry = { at: number; promise: Promise<ServerStats> };
const serverStatsCache = new Map<string, StatsCacheEntry>();

/** Same as `getServerStats` but shares in-flight / fresh results for ~30s. */
export async function getServerStatsCached(serverId: string): Promise<ServerStats> {
	const hit = serverStatsCache.get(serverId);
	if (hit && Date.now() - hit.at < STATS_CACHE_TTL_MS) {
		return hit.promise;
	}
	const promise = getServerStats(serverId).catch((error: unknown) => {
		serverStatsCache.delete(serverId);
		throw error;
	});
	serverStatsCache.set(serverId, { at: Date.now(), promise });
	return promise;
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await fn(items[index] as T);
		}
	};
	const poolSize = Math.min(concurrency, items.length);
	await Promise.all(Array.from({ length: poolSize }, () => worker()));
	return results;
}

/**
 * Collect live metrics for many servers with a bounded SSH pool and the
 * shared TTL cache. Failed hosts map to `null` so one bad node does not
 * fail the whole servers table.
 */
export async function getServerStatsBatch(
	serverIds: string[],
): Promise<Record<string, ServerStats | null>> {
	const unique = [...new Set(serverIds.filter(Boolean))];
	const pairs = await mapWithConcurrency(unique, STATS_BATCH_CONCURRENCY, async (serverId) => {
		try {
			return [serverId, await getServerStatsCached(serverId)] as const;
		} catch {
			return [serverId, null] as const;
		}
	});
	return Object.fromEntries(pairs);
}
