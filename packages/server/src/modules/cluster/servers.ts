import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { servers, webServerSettings } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";

export const NIXPLOY_NETWORK = "nixploy-network";
export const TRAEFIK_SERVICE_NAME = "nixploy-traefik";
export const TRAEFIK_IMAGE = "traefik:v3.5.0";
export const TRAEFIK_CONFIG_DIR = "/etc/nixploy/traefik";

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
};

/** Traefik static config (`traefik.yml`) written on the Nixploy host. */
export function buildTraefikStaticConfig(letsEncryptEmail?: string | null): string {
	const email = letsEncryptEmail?.trim() || "nixploy@localhost";
	return `global:
  checkNewVersion: false
  sendAnonymousUsage: false
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
    http:
      tls:
        certResolver: letsencrypt
providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: ${email}
      storage: /etc/traefik/dynamic/acme.json
      httpChallenge:
        entryPoint: web
api:
  insecure: true
`;
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

export async function removeServer(serverId: string, organizationId: string) {
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
		throw new Error("SSH connection failed: unexpected response to `echo ok`");
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
		throw new Error(`Failed to read swarm ${role} join token from the primary host`);
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
		throw new Error("Could not determine primary swarm advertise address");
	}

	const port = addr.includes(":") ? "" : ":2377";
	return `docker swarm join --token ${token} ${addr}${port}`;
}

/**
 * Idempotent remote provisioning of a managed server:
 * install Docker if missing, join the *primary* Swarm (worker or manager),
 * ensure the shared overlay network exists on managers. Traefik stays on the
 * primary cluster (global, manager-constrained) — remotes do not run their
 * own swarm or Traefik. Safe to re-run; the accumulated shell log is
 * persisted on the server row (`command` column).
 */
export async function setupServer(serverId: string): Promise<string> {
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

	try {
		const server = await db.query.servers.findFirst({
			where: eq(servers.serverId, serverId),
		});
		if (!server) {
			throw new Error(`Server not found: ${serverId}`);
		}
		const role: SwarmRole = server.swarmRole === "manager" ? "manager" : "worker";

		await step("test connection", "echo ok");

		await step(
			"install docker",
			`if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; else echo "docker already installed: $(docker version --format '{{.Server.Version}}' 2>/dev/null)"; fi`,
		);

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

		// Overlay networks are cluster-scoped; create from a manager if missing.
		// Workers cannot create overlay networks.
		if (role === "manager") {
			await step(
				"create network",
				`if [ -z "$(docker network ls --filter name=^${NIXPLOY_NETWORK}$ --format '{{.Name}}')" ]; then docker network create --driver overlay --attachable ${NIXPLOY_NETWORK}; else echo "network ${NIXPLOY_NETWORK} already exists"; fi`,
			);

			// Managers may schedule the global Traefik service; ensure dirs exist
			// so bind mounts succeed if Traefik lands on this node.
			await step(
				"prepare traefik dirs",
				`mkdir -p ${TRAEFIK_CONFIG_DIR}/dynamic && touch ${TRAEFIK_CONFIG_DIR}/dynamic/acme.json && chmod 600 ${TRAEFIK_CONFIG_DIR}/dynamic/acme.json`,
			);

			const staticConfig = buildTraefikStaticConfig(await getLetsEncryptEmail());
			await step(
				"write traefik static config",
				`cat > ${TRAEFIK_CONFIG_DIR}/traefik.yml << 'NIXPLOY_TRAEFIK_EOF'\n${staticConfig}NIXPLOY_TRAEFIK_EOF`,
			);
		} else {
			log.push("# worker node — overlay network and Traefik stay on managers");
		}

		const command = log.join("\n");
		await db
			.update(servers)
			.set({ command, serverStatus: "active" })
			.where(eq(servers.serverId, serverId));
		return command;
	} catch (error) {
		const command = log.join("\n");
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
	disk: { totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: string };
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
