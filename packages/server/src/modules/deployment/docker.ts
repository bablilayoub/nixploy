import { type ChildProcess, spawn } from "node:child_process";
import Docker from "dockerode";
import { eq } from "drizzle-orm";
import { Client as SshClient } from "ssh2";
import { db } from "../../db";
import { servers } from "../../db/schema";
import {
	execAsync,
	execAsyncRemote,
	execAsyncWithStdin,
	remoteCommandTimeoutMs,
	verifyRemoteHostKey,
} from "../../utils/exec";
import { shellQuote } from "./paths";

/**
 * Get a dockerode client for a managed server.
 * - `serverId` null/undefined → the Nixploy host's local docker socket.
 * - otherwise → docker engine API tunneled over SSH (docker-modem ssh protocol).
 */
export async function getDocker(serverId?: string | null): Promise<Docker> {
	if (!serverId) {
		return new Docker({
			socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
		});
	}
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
	return new Docker({
		protocol: "ssh",
		host: server.ipAddress,
		port: server.port,
		username: server.username,
		sshOptions: {
			privateKey: sshKey.privateKey,
			hostVerifier: (key: Buffer) => verifyRemoteHostKey(serverId, key),
		},
	});
}

/** Error thrown when a spawned command exits non-zero (or is killed). */
export class CommandError extends Error {
	constructor(
		message: string,
		readonly exitCode: number | null,
		readonly killed: boolean,
	) {
		super(message);
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
	 * Hard timeout for remote (SSH) commands. Defaults to
	 * `NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS` or 30 minutes.
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

	const signalTree = (signal: NodeJS.Signals) => {
		try {
			if (child.pid) {
				process.kill(-child.pid, signal);
			} else {
				child.kill(signal);
			}
		} catch {
			// Process-group signalling is unsupported (e.g. Windows) or the
			// group already exited — fall back to signalling the shell itself.
			try {
				child.kill(signal);
			} catch {
				// already exited
			}
		}
	};

	const done = new Promise<void>((resolve, reject) => {
		child.stdout?.on("data", (d: Buffer) => options.onData?.(d.toString()));
		child.stderr?.on("data", (d: Buffer) => options.onData?.(d.toString()));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
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
			signalTree("SIGTERM");
			// Escalate if the process ignores SIGTERM.
			setTimeout(() => signalTree("SIGKILL"), 5_000).unref();
		},
		done,
	};
}

async function spawnRemote(
	serverId: string,
	command: string,
	options: SpawnOptions,
): Promise<TargetedProcess> {
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

	const conn = new SshClient();
	await new Promise<void>((resolve, reject) => {
		conn
			.on("ready", () => resolve())
			.on("error", reject)
			.connect({
				host: server.ipAddress,
				port: server.port,
				username: server.username,
				privateKey: sshKey.privateKey,
				readyTimeout: 30_000,
				hostVerifier: (key: Buffer) => verifyRemoteHostKey(serverId, key),
			});
	});

	let stream: import("ssh2").ClientChannel;
	try {
		stream = await new Promise<import("ssh2").ClientChannel>((resolve, reject) => {
			// The first stderr line carries the remote shell's pid so kill() can
			// terminate the actual command tree, not just the SSH channel.
			const remoteCommand =
				`printf '%s\\n' '${REMOTE_PID_MARKER}'"$$" >&2; ` +
				(options.cwd ? `cd ${shellQuote(options.cwd)} && ${command}` : command);
			conn.exec(remoteCommand, (err, s) => (err ? reject(err) : resolve(s)));
		});
	} catch (error) {
		// The handshake succeeded but the channel could not be opened: without
		// this the authenticated socket leaks until the remote side times out.
		conn.end();
		throw error;
	}

	let killed = false;
	let remotePid: number | null = null;
	/** Kill of the remote command tree requested before the pid marker arrived. */
	let killPending = false;
	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);

	/**
	 * Terminate the remote command tree (the shell and every child) and then
	 * tear the channel down. Closing the channel alone leaves builds/clones
	 * running on the server; the `pkill` runs on a second exec channel over
	 * the same connection.
	 */
	const killRemoteTree = (pid: number) => {
		let closed = false;
		const closeChannel = () => {
			if (closed) return;
			closed = true;
			stream.close();
			conn.end();
		};
		try {
			conn.exec(`pkill -TERM -P ${pid} ; kill -TERM ${pid} ; true`, () => closeChannel());
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
				`Remote command timed out after ${Math.round(timeoutMs / 1000)}s on server ${server.name}`,
				null,
				false,
			);
			if (remotePid) {
				// Stop the remote process too — a timed-out build must not keep
				// consuming the server after we gave up on it. killRemoteTree
				// owns the teardown (it closes the connection once pkill ran),
				// so settle without destroying the socket underneath it.
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
				conn.destroy();
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
		conn.on("error", (err: Error) =>
			fail(new CommandError(`SSH connection error: ${err.message}`, null, killed)),
		);
		stream.on("close", (code: number | null) => {
			finish(() => {
				conn.end();
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
								: `Remote command failed (exit ${code}) on server ${server.name}`,
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
					stream.close();
					conn.end();
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
