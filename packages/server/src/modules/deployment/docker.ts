import { type ChildProcess, spawn } from "node:child_process";
import Docker from "dockerode";
import { eq } from "drizzle-orm";
import { Client as SshClient } from "ssh2";
import { db } from "../../db";
import { servers } from "../../db/schema";
import {
	execAsync,
	execAsyncRemote,
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

	const stream = await new Promise<import("ssh2").ClientChannel>((resolve, reject) => {
		// The first stderr line carries the remote shell's pid so kill() can
		// terminate the actual command tree, not just the SSH channel.
		const remoteCommand =
			`printf '%s\\n' '${REMOTE_PID_MARKER}'"$$" >&2; ` +
			(options.cwd ? `cd ${shellQuote(options.cwd)} && ${command}` : command);
		conn.exec(remoteCommand, (err, s) => (err ? reject(err) : resolve(s)));
	});

	let killed = false;
	let remotePid: number | null = null;
	const parsePid = createPidParser((pid) => {
		remotePid = pid;
	});
	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);

	const done = new Promise<void>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			fail(
				new CommandError(
					`Remote command timed out after ${Math.round(timeoutMs / 1000)}s on server ${server.name}`,
					null,
					false,
				),
			);
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
			// Kill the remote command tree first — closing the channel alone
			// leaves builds/clones running on the server.
			if (remotePid) {
				const pid = remotePid;
				try {
					conn.exec(`pkill -TERM -P ${pid} ; kill -TERM ${pid} ; true`, () => {
						stream.close();
						conn.end();
					});
					// Fallback: never leave the channel open if the kill exec stalls.
					setTimeout(() => {
						stream.close();
						conn.end();
					}, 2_000).unref();
					return;
				} catch {
					// fall through to closing the channel
				}
			}
			stream.close();
			conn.end();
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
 * Write a text file on the target server (base64 through the shell, so it
 * works identically locally and over SSH). Parent dirs are created.
 */
export async function writeFileTargeted(
	serverId: string | null | undefined,
	absPath: string,
	content: string | Buffer,
	mode?: string,
): Promise<void> {
	const dir = absPath.slice(0, absPath.lastIndexOf("/")) || "/";
	const b64 = (Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")).toString(
		"base64",
	);
	const chmod = mode ? ` && chmod ${mode} ${shellQuote(absPath)}` : "";
	const cmd = `mkdir -p ${shellQuote(dir)} && printf %s ${shellQuote(b64)} | base64 -d > ${shellQuote(absPath)}${chmod}`;
	if (serverId) {
		await execAsyncRemote(serverId, cmd);
	} else {
		await execAsync(cmd);
	}
}
