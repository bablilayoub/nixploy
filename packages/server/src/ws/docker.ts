import type Docker from "dockerode";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import { db } from "../db";
import { servers } from "../db/schema";
import { getLocalDocker, resolveLocalContainer } from "../modules/docker/containers";
import { isProtectedPlatformName } from "../modules/docker/protected";
import { execAsyncRemote, verifyRemoteHostKey } from "../utils/exec";
import { acquireSsh } from "../utils/ssh-pool";

const SSH_READY_TIMEOUT_MS = 30_000;
const EXEC_TIMEOUT_MS = 15_000;

const shq = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The local dockerode client and the label-based container lookup live in
 * `modules/docker/containers.ts` (the metrics pass and the monitoring router
 * need them too); re-exported here under their original names.
 */
export { getLocalDocker as getDocker, resolveLocalContainer };

/** Resolve a local container by exact Docker ID (short or full). */
export async function resolveLocalContainerById(
	containerId: string,
): Promise<Docker.Container | null> {
	const docker = getLocalDocker();
	try {
		const container = docker.getContainer(containerId);
		const info = await container.inspect();
		if (!info.State?.Running) return null;
		return container;
	} catch {
		return null;
	}
}

/** Labels Nixploy deploys stamp on every task/container, in resolution order. */
const APP_NAME_LABELS = [
	"com.docker.stack.namespace",
	"com.docker.compose.project",
	"com.docker.swarm.service.name",
] as const;

/**
 * Resolve the Nixploy appName a container belongs to from its Swarm/compose
 * labels, or null when it carries none (platform or hand-run containers).
 */
export async function resolveContainerAppName(
	containerId: string,
	serverId: string | null | undefined,
): Promise<string | null> {
	let labels: Record<string, string> = {};
	if (serverId) {
		const format = APP_NAME_LABELS.map((label) => `{{index .Config.Labels "${label}"}}`).join("|");
		const out = (
			await execAsyncRemote(serverId, `docker inspect --format ${shq(format)} ${shq(containerId)}`)
		).trim();
		const parts = out.split("|");
		labels = Object.fromEntries(APP_NAME_LABELS.map((label, i) => [label, parts[i] ?? ""]));
	} else {
		const info = await getLocalDocker().getContainer(containerId).inspect();
		labels = info.Config?.Labels ?? {};
	}
	for (const label of APP_NAME_LABELS) {
		const value = labels[label]?.trim();
		if (value) return value;
	}
	return null;
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
		const info = await getLocalDocker().getContainer(containerId).inspect();
		name = info.Name ?? "";
	}
	if (isProtectedPlatformName(name)) {
		throw new Error(
			`Container "${name.replace(/^\//, "")}" is a Nixploy platform service and cannot be accessed from here`,
		);
	}
}

/**
 * Reserve a channel on the server's pooled SSH connection and run `fn` with
 * the shared client. Use this for short commands (`docker ps`, one-shot
 * `docker stats`); long follows should hold their own {@link acquireSsh} lease
 * for the life of the stream so the channel budget stays honest.
 *
 * Never call `end()`/`destroy()` on the client handed to `fn` — it is shared
 * with every other command running against that server.
 */
export async function withServerSsh<T>(
	serverId: string,
	fn: (client: Client) => Promise<T>,
): Promise<T> {
	const lease = await acquireSsh(serverId);
	try {
		return await fn(lease.client);
	} finally {
		lease.release();
	}
}

/** Reserve a channel for a long-lived stream; release the lease when it ends. */
export { acquireSsh as acquireServerSsh } from "../utils/ssh-pool";

/**
 * Open a **dedicated** SSH connection to a managed remote server (same lookup
 * as `execAsyncRemote` used to do).
 *
 * The only remaining caller is the interactive terminal (`ws/docker-terminal.ts`),
 * which owns its connection for the session and ends it on close. Everything
 * else goes through {@link withServerSsh} / {@link acquireServerSsh} so it
 * shares the pooled connection; moving the terminal over needs the same lease
 * treatment (see the handoff).
 */
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
		let channel: import("ssh2").ClientChannel | null = null;
		const timer = setTimeout(() => {
			// Close the wedged channel: the connection is pooled and shared, so
			// leaving the session open would eat one of its channel slots.
			try {
				channel?.close();
			} catch {
				// channel already gone
			}
			reject(new Error(`Remote command timed out: ${command}`));
		}, EXEC_TIMEOUT_MS);
		timer.unref?.();
		conn.exec(command, (err, stream) => {
			if (err) {
				clearTimeout(timer);
				reject(err);
				return;
			}
			channel = stream;
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
