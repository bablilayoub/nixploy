import Docker from "dockerode";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import { db } from "../db";
import { servers } from "../db/schema";
import { isProtectedPlatformName } from "../modules/docker/protected";
import { execAsyncRemote, verifyRemoteHostKey } from "../utils/exec";

const SSH_READY_TIMEOUT_MS = 30_000;
const EXEC_TIMEOUT_MS = 15_000;

let dockerInstance: Docker | null = null;

const shq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Local dockerode client (daemon socket on the Nixploy host). */
export function getDocker(): Docker {
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
	const docker = getDocker();
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

/** Resolve a local container by exact Docker ID (short or full). */
export async function resolveLocalContainerById(
	containerId: string,
): Promise<Docker.Container | null> {
	const docker = getDocker();
	try {
		const container = docker.getContainer(containerId);
		const info = await container.inspect();
		if (!info.State?.Running) return null;
		return container;
	} catch {
		return null;
	}
}

/**
 * Refuse terminal/logs attach to Nixploy platform containers (parity with
 * `docker.containerAction` protection).
 */
export async function assertContainerNotProtected(
	containerId: string,
	serverId: string | null,
): Promise<void> {
	let name: string;
	if (serverId) {
		name = (
			await execAsyncRemote(serverId, `docker inspect --format '{{.Name}}' ${shq(containerId)}`)
		).trim();
	} else {
		const info = await getDocker().getContainer(containerId).inspect();
		name = info.Name ?? "";
	}
	if (isProtectedPlatformName(name)) {
		throw new Error(
			`Container "${name.replace(/^\//, "")}" is a Nixploy platform service and cannot be accessed from here`,
		);
	}
}

/** Open an SSH connection to a managed remote server (same lookup as execAsyncRemote). */
export async function connectToServer(serverId: string): Promise<Client> {
	const server = await db.query.servers.findFirst({
		where: eq(servers.serverId, serverId),
		with: { sshKey: true },
	});
	if (!server) {
		throw new Error(`Server not found: ${serverId}`);
	}
	const sshKey = server.sshKey;
	if (!sshKey) {
		throw new Error(`Server ${server.name} (${serverId}) has no SSH key attached`);
	}

	return new Promise<Client>((resolve, reject) => {
		const conn = new Client();
		conn
			.on("ready", () => resolve(conn))
			.on("error", (err) => reject(err))
			.connect({
				host: server.ipAddress,
				port: server.port,
				username: server.username,
				privateKey: sshKey.privateKey,
				readyTimeout: SSH_READY_TIMEOUT_MS,
				hostVerifier: (key: Buffer) => verifyRemoteHostKey(serverId, key),
			});
	});
}

/** Run a short command over an open SSH connection and resolve with trimmed stdout. */
export function execOnConnection(conn: Client, command: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			reject(new Error(`Remote command timed out: ${command}`));
		}, EXEC_TIMEOUT_MS);
		conn.exec(command, (err, stream) => {
			if (err) {
				clearTimeout(timer);
				reject(err);
				return;
			}
			stream
				.on("close", (code: number | null) => {
					clearTimeout(timer);
					if (code === 0 || code === null) {
						resolve(stdout.trim());
					} else {
						reject(new Error(`Remote command failed (exit ${code}): ${command} — ${stderr}`));
					}
				})
				.on("data", (data: Buffer) => {
					stdout += data.toString();
				});
			stream.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
		});
	});
}

/** Resolve a container ID for an app on a remote server (labels only). */
export async function resolveRemoteContainerId(
	conn: Client,
	appName: string,
): Promise<string | null> {
	const filters = [
		`label=com.docker.swarm.service.name=${appName}`,
		`label=com.docker.compose.project=${appName}`,
		`label=com.docker.stack.namespace=${appName}`,
	];
	for (const filter of filters) {
		const id = await execOnConnection(conn, `docker ps -q --filter ${shq(filter)} | head -n 1`);
		if (id) return id;
	}
	return null;
}

/** Shell command shared by local + remote terminals: prefer bash, fall back to sh. */
export const SHELL_FALLBACK_COMMAND = "command -v bash >/dev/null 2>&1 && exec bash || exec sh";
