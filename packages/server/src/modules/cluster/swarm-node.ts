import { eq } from "drizzle-orm";
import { db } from "../../db";
import { servers } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { shellQuote } from "../deployment/paths";
import { DomainError, notFound } from "../errors";
import { matchSwarmNode, type SwarmNodeSummary } from "./placement";

/**
 * Resolve the PRIMARY-swarm node id of a managed server.
 *
 * Managed servers join the primary swarm (`setupServer`), usually as workers.
 * Swarm service objects therefore always live on the primary manager, and a
 * service pinned to a server is tied to it by the placement constraint
 * `node.id==<swarmNodeId>` (see `placement.ts`). The id is recorded on the
 * server row by setup and re-resolved lazily here when missing or stale.
 */

const PRIMARY_TIMEOUT_MS = 15_000;
const REMOTE_TIMEOUT_MS = 30_000;

/** The server is not (or no longer) a usable node of the primary swarm. */
export class ServerNotInSwarmError extends DomainError {
	constructor(
		readonly serverId: string,
		message: string,
	) {
		super("PRECONDITION_FAILED", message);
		this.name = "ServerNotInSwarmError";
	}
}

/** `docker node inspect` on the primary: node state, or null when unknown there. */
export async function inspectPrimaryNode(swarmNodeId: string): Promise<{ state: string } | null> {
	try {
		const out = await execAsync(
			`docker node inspect --format '{{.Status.State}}' ${shellQuote(swarmNodeId)}`,
			{ timeout: PRIMARY_TIMEOUT_MS },
		);
		return { state: out.trim().toLowerCase() };
	} catch {
		return null;
	}
}

/** Every node of the primary swarm with the fields the fallback match needs. */
async function listPrimaryNodes(): Promise<SwarmNodeSummary[]> {
	const ids = (await execAsync("docker node ls -q", { timeout: PRIMARY_TIMEOUT_MS }))
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (ids.length === 0) return [];
	const out = await execAsync(
		`docker node inspect --format '{{.ID}}|{{.Description.Hostname}}|{{.Status.Addr}}' ${ids.map(shellQuote).join(" ")}`,
		{ timeout: PRIMARY_TIMEOUT_MS },
	);
	return out
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [id = "", hostname = "", addr = ""] = line.split("|");
			return { id, hostname, addr };
		})
		.filter((node) => node.id);
}

/**
 * What the server's own daemon says over SSH: its local swarm state and node
 * id, or null when the host is unreachable.
 */
async function readRemoteSwarmNode(
	serverId: string,
): Promise<{ state: string; nodeId: string } | null> {
	try {
		const out = await execAsyncRemote(
			serverId,
			`docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.NodeID}}' 2>/dev/null || echo inactive`,
			{ timeoutMs: REMOTE_TIMEOUT_MS },
		);
		const [state = "inactive", nodeId = ""] = out.trim().split(/\s+/);
		return { state: state.toLowerCase(), nodeId };
	} catch {
		return null;
	}
}

function assertNodeReady(
	server: { serverId: string; name: string },
	swarmNodeId: string,
	state: string,
): void {
	if (state === "ready") return;
	throw new ServerNotInSwarmError(
		server.serverId,
		`Server "${server.name}" is ${state || "unknown"} in the swarm (node ${swarmNodeId}) — tasks cannot be scheduled on it until it is back; check \`docker node ls\` on the Nixploy host`,
	);
}

/**
 * Node id of `serverId` in the primary swarm, persisted on the row once
 * verified. Resolution order:
 * 1. the recorded `swarmNodeId`, as long as the primary still knows it;
 * 2. `docker info` over SSH on the server (authoritative for the daemon);
 * 3. the primary's `docker node ls` matched by advertised address/hostname
 *    when the server is unreachable over SSH.
 * Throws {@link ServerNotInSwarmError} when the server has not joined the
 * primary swarm (run Setup), joined a different swarm, or its node is down.
 */
export async function getServerSwarmNodeId(serverId: string): Promise<string> {
	const server = await db.query.servers.findFirst({
		where: eq(servers.serverId, serverId),
		columns: { serverId: true, name: true, ipAddress: true, swarmNodeId: true },
	});
	if (!server) {
		throw notFound(`Server not found: ${serverId}`);
	}

	if (server.swarmNodeId) {
		const node = await inspectPrimaryNode(server.swarmNodeId);
		if (node) {
			assertNodeReady(server, server.swarmNodeId, node.state);
			return server.swarmNodeId;
		}
		// Stale pin (server left / was re-provisioned) — fall through and re-resolve.
	}

	const notJoined = (detail: string) =>
		new ServerNotInSwarmError(
			server.serverId,
			`Server "${server.name}" has not joined the swarm (${detail}) — run Setup on the server, then deploy again`,
		);

	let candidate: string | null = null;
	const remote = await readRemoteSwarmNode(serverId);
	if (remote) {
		if (remote.state !== "active" || !remote.nodeId) {
			throw notJoined(`docker reports swarm state "${remote.state}"`);
		}
		candidate = remote.nodeId;
	} else {
		// SSH unreachable: the primary may still know the node.
		candidate = matchSwarmNode(await listPrimaryNodes().catch(() => []), server.ipAddress);
		if (!candidate) throw notJoined("unreachable over SSH and unknown to the primary swarm");
	}

	const node = await inspectPrimaryNode(candidate);
	if (!node) {
		throw new ServerNotInSwarmError(
			server.serverId,
			`Server "${server.name}" is part of a swarm the Nixploy host does not manage (node ${candidate}) — run \`docker swarm leave --force\` on it and re-run Setup`,
		);
	}
	await db.update(servers).set({ swarmNodeId: candidate }).where(eq(servers.serverId, serverId));
	assertNodeReady(server, candidate, node.state);
	return candidate;
}
