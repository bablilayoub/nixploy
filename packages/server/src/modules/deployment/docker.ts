import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import type { Socket } from "node:net";
import Docker from "dockerode";
import type { ClientChannel } from "ssh2";
import {
	describeTimeout,
	execAsync,
	execAsyncRemote,
	execAsyncWithStdin,
	killProcessTree,
	localCommandTimeoutMs,
	remoteCommandTimeoutMs,
} from "../../utils/exec";
import { acquireSsh, type SshLease, sshPoolLimits } from "../../utils/ssh-pool";
import { DomainError, type DomainErrorCode } from "../errors";
import { shellQuote } from "./paths";

/**
 * The Docker engine API speaks HTTP over a channel opened with
 * `docker system dial-stdio` — the same trick docker-modem's `ssh` protocol
 * uses, except docker-modem builds a brand new ssh2 `Client` (TCP + key
 * exchange + auth) for **every single API call**. Here the channel comes from
 * the server's pooled connection instead (architecture audit #7).
 */
const DOCKER_DIAL_COMMAND = "docker system dial-stdio";

/** Placeholder so docker-modem takes its socket path branch; our agent dials. */
const POOLED_SOCKET_PATH = "/nixploy/ssh";

/**
 * ssh2 channels are Duplex streams, not `net.Socket`s. Node's HTTP agent only
 * calls these when a timeout or keep-alive is configured (neither is, here),
 * but a missing method would be a hard crash rather than a no-op — so stub
 * them defensively before handing the channel to `http`.
 */
function asAgentSocket(stream: ClientChannel): Socket {
	const candidate = stream as unknown as Record<string, unknown>;
	for (const method of ["setNoDelay", "setKeepAlive", "setTimeout", "ref", "unref"]) {
		if (typeof candidate[method] !== "function") {
			candidate[method] = function noop(this: unknown) {
				return this;
			};
		}
	}
	return stream as unknown as Socket;
}

/** An HTTP agent whose sockets are channels on the server's pooled SSH connection. */
function createPooledSshAgent(serverId: string): http.Agent {
	const agent = new http.Agent({
		keepAlive: false,
		// Queue inside the agent rather than inside the SSH pool, so a burst of
		// Docker API calls never starves `execAsyncRemote` of channels.
		maxSockets: Math.max(1, sshPoolLimits().maxChannels - 1),
	});
	agent.createConnection = ((
		_options: unknown,
		callback: (error: Error | null, socket?: Socket) => void,
	) => {
		void acquireSsh(serverId)
			.then((lease) => {
				lease.client.exec(DOCKER_DIAL_COMMAND, (error, stream) => {
					if (error) {
						lease.discard(error);
						callback(error);
						return;
					}
					stream.once("close", () => lease.release());
					lease.onConnectionLost(() => {
						try {
							stream.destroy();
						} catch {
							// channel already gone
						}
					});
					callback(null, asAgentSocket(stream));
				});
			})
			.catch((error: unknown) => {
				callback(error instanceof Error ? error : new Error(String(error)));
			});
		return undefined as unknown as Socket;
	}) as typeof agent.createConnection;
	return agent;
}

/**
 * One dockerode client per managed server. The client itself is stateless —
 * every request takes a fresh channel from the pool — so caching it just
 * avoids rebuilding the agent on each call.
 */
const remoteDockerClients = new Map<string, Docker>();

/**
 * Get a dockerode client for a managed server.
 * - `serverId` null/undefined → the Nixploy host's local docker socket.
 * - otherwise → docker engine API over a channel of the server's pooled SSH
 *   connection (`utils/ssh-pool.ts`).
 *
 * An unknown server or a missing SSH key now surfaces as a `DomainError` from
 * the first API call rather than from this constructor: there is no DB read
 * here any more.
 */
export async function getDocker(serverId?: string | null): Promise<Docker> {
	if (!serverId) {
		return new Docker({
			socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
		});
	}
	const cached = remoteDockerClients.get(serverId);
	if (cached) return cached;
	// `agent` is read by docker-modem (`Modem.agent` → per-request options) but
	// is missing from @types/dockerode's `DockerOptions`.
	const client = new Docker({
		socketPath: POOLED_SOCKET_PATH,
		agent: createPooledSshAgent(serverId),
	} as Docker.DockerOptions & { agent: http.Agent });
	remoteDockerClients.set(serverId, client);
	return client;
}

/** Drop the cached dockerode client for a server (row changed / removed). */
export function forgetRemoteDocker(serverId: string): void {
	const client = remoteDockerClients.get(serverId);
	remoteDockerClients.delete(serverId);
	const agent = (client?.modem as { agent?: http.Agent } | undefined)?.agent;
	agent?.destroy();
}

/**
 * Error thrown when a spawned command exits non-zero (or is killed).
 *
 * A `DomainError` so the failure keeps its message through the error boundary
 * (`trpc/init.ts`) and reaches REST/MCP/CLI callers as a real code instead of
 * the generic 500 an unknown `Error` gets in production — no router has to
 * re-wrap it. Messages never carry the command line (it embeds registry
 * passwords and dump credentials); `exitCode` and `killed` stay the machine-
 * readable half the deploy worker and the hook runner branch on.
 */
export class CommandError extends DomainError {
	constructor(
		message: string,
		readonly exitCode: number | null,
		readonly killed: boolean,
		code: DomainErrorCode = "INTERNAL_SERVER_ERROR",
	) {
		super(code, message);
		this.name = "CommandError";
	}
}

/** Handle for a command running locally or over SSH. */
export interface TargetedProcess {
	/** OS pid (local processes only; undefined over SSH). */
	readonly pid?: number;
	/** Terminate the process (SIGTERM locally, closes the channel over SSH). */
	kill(): void;
	/** Resolves on exit 0, rejects with {@link CommandError} otherwise. */
	done: Promise<void>;
}

export interface SpawnOptions {
	cwd?: string;
	onData?: (chunk: string) => void;
	/**
	 * Hard timeout. Defaults to `NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS` (SSH) /
	 * `NIXPLOY_COMMAND_TIMEOUT_MS` (local) or 30 minutes. On expiry the whole
	 * process tree is killed and `done` rejects with a {@link CommandError}
	 * whose message says so (`killed: false` — a timeout is a failure, not a
	 * cancellation).
	 */
	timeoutMs?: number;
}

/** Marker prefix so the remote shell reports its pid on the first stderr line. */
const REMOTE_PID_MARKER = "__nixploy_remote_pid__:";

/**
 * Extract the remote pid marker from the first stderr line; everything else
 * is forwarded to the log unchanged.
 */
function createPidParser(onPid: (pid: number) => void): (chunk: string) => string {
	let found = false;
	let buffer = "";
	return (chunk: string): string => {
		if (found) return chunk;
		buffer += chunk;
		const newline = buffer.indexOf("\n");
		if (newline === -1) return "";
		const head = buffer.slice(0, newline);
		const rest = buffer.slice(newline + 1);
		buffer = "";
		if (head.startsWith(REMOTE_PID_MARKER)) {
			const pid = Number.parseInt(head.slice(REMOTE_PID_MARKER.length).trim(), 10);
			if (Number.isFinite(pid) && pid > 0) onPid(pid);
			found = true;
			return rest;
		}
		// Not a marker (unexpected shell noise) — forward untouched.
		found = true;
		return `${head}\n${rest}`;
	};
}

/**
 * Spawn a shell command on the target server, streaming combined
 * stdout/stderr to `onData`. Local → `sh -c` (Alpine runtime has no bash);
 * remote → ssh2 channel. Killing the returned handle is how deployment
 * cancellation stops builds.
 */
export async function spawnTargeted(
	serverId: string | null | undefined,
	command: string,
	options: SpawnOptions = {},
): Promise<TargetedProcess> {
	if (!serverId) {
		return spawnLocal(command, options);
	}
	return spawnRemote(serverId, command, options);
}

function spawnLocal(command: string, options: SpawnOptions): TargetedProcess {
	// Prefer /bin/sh — the production image is node:22-alpine (no bash).
	// `detached` puts the shell in its own process group so kill() can signal
	// the whole build tree, not just the `sh -c` wrapper.
	const child: ChildProcess = spawn("sh", ["-c", command], { cwd: options.cwd, detached: true });
	let killed = false;
	let timedOut = false;
	const timeoutMs = localCommandTimeoutMs(options.timeoutMs);

	// Process-group signalling is unsupported (e.g. Windows) or the group
	// already exited → killProcessTree falls back to signalling the shell.
	const signalTree = (signal: NodeJS.Signals) => killProcessTree(child, signal);
	const terminate = () => {
		signalTree("SIGTERM");
		// Escalate if the process ignores SIGTERM.
		setTimeout(() => signalTree("SIGKILL"), 5_000).unref();
	};

	const done = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, timeoutMs);
		timer.unref?.();
		child.stdout?.on("data", (d: Buffer) => options.onData?.(d.toString()));
		child.stderr?.on("data", (d: Buffer) => options.onData?.(d.toString()));
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (timedOut) {
				reject(
					new CommandError(
						`Command timed out after ${describeTimeout(timeoutMs)}`,
						code,
						false,
						"TIMEOUT",
					),
				);
			} else if (code === 0) {
				resolve();
			} else {
				reject(
					new CommandError(
						killed ? "Command was cancelled" : `Command failed (exit ${code})`,
						code,
						killed,
					),
				);
			}
		});
	});

	return {
		pid: child.pid,
		kill: () => {
			killed = true;
			terminate();
		},
		done,
	};
}

async function spawnRemote(
	serverId: string,
	command: string,
	options: SpawnOptions,
): Promise<TargetedProcess> {
	const lease: SshLease = await acquireSsh(serverId);
	const serverName = lease.server.name;

	let stream: ClientChannel;
	try {
		stream = await new Promise<ClientChannel>((resolve, reject) => {
			// The first stderr line carries the remote shell's pid so kill() can
			// terminate the actual command tree, not just the SSH channel.
			const remoteCommand =
				`printf '%s\\n' '${REMOTE_PID_MARKER}'"$$" >&2; ` +
				(options.cwd ? `cd ${shellQuote(options.cwd)} && ${command}` : command);
			lease.client.exec(remoteCommand, (err, s) => (err ? reject(err) : resolve(s)));
		});
	} catch (error) {
		// The connection is healthy but refused a session: drop it rather than
		// hand the next caller a connection that cannot open channels.
		lease.discard(error);
		throw error;
	}
	// The pool slot follows the channel, whatever settles `done` first.
	stream.once("close", () => lease.release());

	let killed = false;
	let remotePid: number | null = null;
	/** Kill of the remote command tree requested before the pid marker arrived. */
	let killPending = false;
	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);

	/**
	 * Terminate the remote command tree (the shell and every child) and then
	 * close the channel. Closing the channel alone leaves builds/clones
	 * running on the server; the `pkill` runs on a second exec channel over
	 * the same pooled connection (it can briefly exceed the channel budget on
	 * purpose — cancelling a build must not queue behind the build itself).
	 */
	const killRemoteTree = (pid: number) => {
		let closed = false;
		const closeChannel = () => {
			if (closed) return;
			closed = true;
			try {
				stream.close();
			} catch {
				// channel already gone
			}
			lease.release();
		};
		try {
			lease.client.exec(`pkill -TERM -P ${pid} ; kill -TERM ${pid} ; true`, (err, killStream) => {
				if (!err) {
					// Drain it: an unread channel stalls the connection's window.
					killStream.resume();
					killStream.stderr.resume();
				}
				closeChannel();
			});
			// Fallback: never leave the channel open if the kill exec stalls.
			setTimeout(closeChannel, 2_000).unref();
		} catch {
			closeChannel();
		}
	};

	const parsePid = createPidParser((pid) => {
		remotePid = pid;
		// kill() raced the marker: now that the pid is known, finish the job.
		if (killPending) killRemoteTree(pid);
	});

	const done = new Promise<void>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			const error = new CommandError(
				`Remote command timed out after ${Math.round(timeoutMs / 1000)}s on server ${serverName}`,
				null,
				false,
				"TIMEOUT",
			);
			if (remotePid) {
				// Stop the remote process too — a timed-out build must not keep
				// consuming the server after we gave up on it. killRemoteTree
				// owns the teardown (it closes the channel once pkill ran), so
				// settle without touching the shared connection underneath it.
				killRemoteTree(remotePid);
				finish(() => reject(error));
				return;
			}
			fail(error);
		}, timeoutMs);
		timer.unref?.();

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		const fail = (error: CommandError) =>
			finish(() => {
				// Only this command's channel goes away — the pooled connection
				// is shared with every other command on the server.
				try {
					stream.close();
				} catch {
					// channel already gone
				}
				lease.release();
				reject(error);
			});

		stream.on("data", (d: Buffer) => options.onData?.(d.toString()));
		stream.stderr.on("data", (d: Buffer) => {
			const chunk = parsePid(d.toString());
			if (chunk) options.onData?.(chunk);
		});
		stream.on("error", (err: Error) =>
			fail(new CommandError(`Remote command stream error: ${err.message}`, null, killed)),
		);
		lease.onConnectionLost((err: Error) =>
			fail(new CommandError(`SSH connection error: ${err.message}`, null, killed)),
		);
		stream.on("close", (code: number | null) => {
			finish(() => {
				if (code === 0 || (code === null && killed)) {
					if (code === null && killed) {
						reject(new CommandError("Command was cancelled", code, true));
						return;
					}
					resolve();
				} else {
					reject(
						new CommandError(
							killed
								? "Command was cancelled"
								: `Remote command failed (exit ${code}) on server ${serverName}`,
							code,
							killed,
						),
					);
				}
			});
		});
	});

	return {
		kill: () => {
			killed = true;
			if (remotePid) {
				killRemoteTree(remotePid);
				return;
			}
			// The pid marker has not arrived yet (cancelled right after spawn):
			// keep the channel open so the marker can still be read, then pkill
			// the tree from the parser callback. Closing the channel first
			// would drop the marker and leave the remote command running.
			killPending = true;
			setTimeout(() => {
				// Marker never showed up (shell noise, connection wedged): give
				// up on a targeted kill and at least release the channel.
				if (!remotePid) {
					try {
						stream.close();
					} catch {
						// channel already gone
					}
					lease.release();
				}
			}, 5_000).unref();
		},
		done,
	};
}

/** Check whether a binary exists on the target server (`command -v`). */
export async function commandExists(
	serverId: string | null | undefined,
	binary: string,
): Promise<boolean> {
	try {
		const cmd = `command -v ${shellQuote(binary)} >/dev/null 2>&1`;
		if (serverId) {
			await execAsyncRemote(serverId, cmd);
		} else {
			await execAsync(cmd);
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Write a file on the target server. The payload is streamed over stdin
 * (`cat > file`) rather than embedded in the command line: keys and drop
 * archives must not sit on argv (`ps`), and a single shell argument is capped
 * at 128 KiB by Linux (`MAX_ARG_STRLEN`). Parent dirs are created.
 */
export async function writeFileTargeted(
	serverId: string | null | undefined,
	absPath: string,
	content: string | Buffer,
	mode?: string,
): Promise<void> {
	const dir = absPath.slice(0, absPath.lastIndexOf("/")) || "/";
	const chmod = mode ? ` && chmod ${mode} ${shellQuote(absPath)}` : "";
	const cmd = `mkdir -p ${shellQuote(dir)} && cat > ${shellQuote(absPath)}${chmod}`;
	await execAsyncWithStdin(cmd, content, { serverId: serverId ?? null });
}
