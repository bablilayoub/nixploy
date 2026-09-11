import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import type { ClientChannel } from "ssh2";
import { getSshKeysPath } from "../modules/deployment/paths";
import { DomainError } from "../modules/errors";
import { acquireSsh } from "./ssh-pool";

/**
 * Host-key pinning lives in `ssh-pool.ts` (the pool needs it while dialling,
 * and a two-way import would be a cycle). Re-exported here because every
 * caller — and `exec.test.ts` — has always imported it from this module.
 */
export {
	clearRemoteHostKey,
	getPinnedHostsDir,
	verifyRemoteHostKey,
} from "./ssh-pool";

/** 50 MB — build/deploy logs can be large. */
const MAX_BUFFER = 1024 * 1024 * 50;

/** Default hard timeout for long-running commands (builds, pulls), local or SSH. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
/** @deprecated alias kept for callers written before local timeouts existed. */
export const DEFAULT_REMOTE_TIMEOUT_MS = DEFAULT_COMMAND_TIMEOUT_MS;

function timeoutFromEnv(name: string): number | null {
	const value = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolve the remote command timeout: explicit override, then
 * `NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS`, then `NIXPLOY_COMMAND_TIMEOUT_MS`,
 * then {@link DEFAULT_COMMAND_TIMEOUT_MS}.
 */
export function remoteCommandTimeoutMs(override?: number): number {
	if (override && override > 0) return override;
	return (
		timeoutFromEnv("NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS") ??
		timeoutFromEnv("NIXPLOY_COMMAND_TIMEOUT_MS") ??
		DEFAULT_COMMAND_TIMEOUT_MS
	);
}

/**
 * Resolve the timeout of a command spawned on the Nixploy host: explicit
 * override, then `NIXPLOY_COMMAND_TIMEOUT_MS`, then
 * {@link DEFAULT_COMMAND_TIMEOUT_MS}. No local spawn runs forever — a wedged
 * `docker build` used to hold a deploy slot until the panel restarted.
 */
export function localCommandTimeoutMs(override?: number): number {
	if (override && override > 0) return override;
	return timeoutFromEnv("NIXPLOY_COMMAND_TIMEOUT_MS") ?? DEFAULT_COMMAND_TIMEOUT_MS;
}

/** Describe a timeout for error messages: "45s" / "30min". */
export function describeTimeout(ms: number): string {
	return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000}min` : `${Math.round(ms / 1000)}s`;
}

/**
 * Signal a detached child's whole process group (the `sh -c` wrapper AND
 * everything it started), falling back to the child alone when process-group
 * signalling is unsupported or the group already exited.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
	try {
		if (child.pid) {
			process.kill(-child.pid, signal);
		} else {
			child.kill(signal);
		}
	} catch {
		try {
			child.kill(signal);
		} catch {
			// already exited
		}
	}
}

/** SIGTERM the tree now and SIGKILL whatever ignores it a few seconds later. */
export function terminateProcessTree(child: ChildProcess, escalateAfterMs = 5_000): void {
	killProcessTree(child, "SIGTERM");
	setTimeout(() => killProcessTree(child, "SIGKILL"), escalateAfterMs).unref();
}

export interface ExecOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/** Hard timeout in ms; defaults to {@link localCommandTimeoutMs} (30 min). */
	timeout?: number;
}

/** Thrown by the local exec helpers when the command tree had to be killed on timeout. */
export class CommandTimeoutError extends DomainError {
	constructor(command: string, timeoutMs: number) {
		super("TIMEOUT", `"${commandLabel(command)}" timed out after ${describeTimeout(timeoutMs)}`);
		this.name = "CommandTimeoutError";
	}
}

interface LocalRunResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

/**
 * Spawn `sh -c command` on the Nixploy host, capture both streams and settle
 * on exit. The child runs **detached** (its own process group) so the
 * timeout can kill the whole tree: `child_process.exec` neither forwards
 * `detached` nor signals grandchildren, and a surviving grandchild keeps the
 * stdio pipes — and therefore the promise — open forever. Output beyond
 * {@link MAX_BUFFER} kills the tree as well (same contract as `exec`).
 */
function runLocal(
	command: string,
	options: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		stdin?: string | Buffer;
		timeoutMs: number;
	},
): Promise<LocalRunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("sh", ["-c", command], {
			cwd: options.cwd,
			env: options.env ? { ...process.env, ...options.env } : process.env,
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
		});
		let stdout = "";
		let stderr = "";
		let captured = 0;
		let timedOut = false;
		let overflow = false;
		const timer = setTimeout(() => {
			timedOut = true;
			terminateProcessTree(child);
		}, options.timeoutMs);
		timer.unref?.();

		const capture = (target: "stdout" | "stderr") => (data: Buffer) => {
			captured += data.length;
			if (captured > MAX_BUFFER) {
				if (!overflow) {
					overflow = true;
					terminateProcessTree(child);
				}
				return;
			}
			if (target === "stdout") stdout += data.toString();
			else stderr += data.toString();
		};
		child.stdout.on("data", capture("stdout"));
		child.stderr.on("data", capture("stderr"));
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (overflow) {
				reject(
					Object.assign(
						new Error(
							`"${commandLabel(command)}" produced more than ${MAX_BUFFER} bytes of output`,
						),
						{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
					),
				);
				return;
			}
			resolve({ code, signal, stdout, stderr, timedOut });
		});
		// EPIPE when the command exits before reading stdin (e.g. `cat > f` on
		// a read-only path): surface the exit error, not an uncaught stream error.
		child.stdin.on("error", () => {});
		if (options.stdin !== undefined) child.stdin.write(options.stdin);
		child.stdin.end();
	});
}

/**
 * Run a shell command on the Nixploy host. Resolves with stdout.
 * Every docker/shell operation in the platform goes through this or
 * {@link execAsyncRemote} so local and remote servers are interchangeable.
 * Bounded by {@link localCommandTimeoutMs}; the rejection on a non-zero exit
 * keeps `child_process.exec`'s shape (`code`, `signal`, `killed`, `stdout`,
 * `stderr`, `cmd`) because callers inspect those fields.
 */
export async function execAsync(command: string, options: ExecOptions = {}): Promise<string> {
	const timeoutMs = localCommandTimeoutMs(options.timeout);
	const result = await runLocal(command, {
		cwd: options.cwd,
		env: options.env,
		timeoutMs,
	});
	if (result.timedOut) throw new CommandTimeoutError(command, timeoutMs);
	if (result.code !== 0) {
		throw Object.assign(new Error(`Command failed: ${command}\n${result.stderr}`), {
			cmd: command,
			code: result.code,
			signal: result.signal,
			killed: result.signal !== null,
			stdout: result.stdout,
			stderr: result.stderr,
		});
	}
	return result.stdout;
}

/**
 * A remote command failed. `message` names only the program (see
 * `commandLabel`) and is safe to show; stderr stays in its own field because
 * it can carry paths, hostnames and credentials.
 */
export class RemoteExecError extends DomainError {
	constructor(
		message: string,
		public readonly stderr: string,
		public readonly exitCode: number | null,
	) {
		super("INTERNAL_SERVER_ERROR", message);
		this.name = "RemoteExecError";
	}
}

/**
 * First word of a command, for error messages. The full command line is kept
 * out of errors on purpose: dump/restore and registry commands embed database
 * passwords and access keys, and errors end up in logs and API responses.
 */
function commandLabel(command: string): string {
	const [program = "command"] = command.trim().split(/\s+/, 1);
	return program;
}

/**
 * OpenSSH known_hosts file used by git-over-ssh clones (custom SSH keys):
 * `<configDir>/ssh/git_known_hosts`. Populated by ssh itself through
 * `StrictHostKeyChecking=accept-new` (first contact pins, later mismatches fail).
 */
export const getGitKnownHostsPath = (): string => path.join(getSshKeysPath(), "git_known_hosts");

interface RemoteRunOptions {
	timeoutMs?: number;
	/** Written to the channel and closed; nothing is written when omitted. */
	stdin?: string | Buffer;
}

/**
 * Run one command on a channel of the server's pooled SSH connection
 * ({@link acquireSsh}) and buffer its stdout. Shared by
 * {@link execAsyncRemote} and {@link execAsyncRemoteWithStdin}, whose error
 * classes and messages are unchanged — only the transport underneath is.
 *
 * The connection is never torn down here: on a command timeout only the
 * channel is closed (which drops the remote command's stdio just as ending
 * the connection used to), so other commands on the same server keep running.
 */
function runRemote(
	lease: Awaited<ReturnType<typeof acquireSsh>>,
	command: string,
	options: RemoteRunOptions,
): Promise<string> {
	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);
	const serverName = lease.server.name;

	return new Promise<string>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		let channel: ClientChannel | null = null;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		/** Give the channel (and with it the pool slot) back after a failure. */
		const abandonChannel = () => {
			if (!channel) {
				lease.release();
				return;
			}
			try {
				channel.close();
			} catch {
				// channel already gone
			}
			// `close` releases the slot; this only covers a wedged channel.
			setTimeout(() => lease.release(), 5_000).unref?.();
		};
		const fail = (error: Error) =>
			finish(() => {
				abandonChannel();
				reject(error);
			});

		// Hard command timeout — a wedged remote command must not pin the
		// channel (and the caller) forever.
		const timer = setTimeout(() => {
			fail(
				new RemoteExecError(
					`Remote "${commandLabel(command)}" timed out after ${describeTimeout(timeoutMs)} on server ${serverName}`,
					stderr,
					null,
				),
			);
		}, timeoutMs);
		timer.unref?.();

		lease.onConnectionLost((error) => finish(() => reject(error)));

		lease.client.exec(command, (err, stream) => {
			if (err) {
				// The handshake worked but the server refused a session: that is a
				// transport fault, so drop the pooled connection rather than reuse it.
				finish(() => {
					lease.discard(err);
					reject(err);
				});
				return;
			}
			channel = stream;
			// The slot follows the channel, whatever settles the promise first.
			stream.once("close", () => lease.release());
			stream
				.on("close", (code: number | null) => {
					finish(() => {
						if (code === 0 || code === null) {
							resolve(stdout);
						} else {
							reject(
								new RemoteExecError(
									`Remote "${commandLabel(command)}" failed (exit ${code}) on server ${serverName}`,
									stderr,
									code,
								),
							);
						}
					});
				})
				.on("data", (data: Buffer) => {
					stdout += data.toString();
				});
			stream.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
			stream.on("error", fail);
			if (options.stdin !== undefined) {
				stream.write(options.stdin);
				stream.end();
			}
		});
	});
}

/**
 * Run a shell command on a remote managed server over SSH (ssh2).
 * Takes a channel on the server's pooled connection (`utils/ssh-pool.ts`) —
 * one connection per server, reused across commands, with keepalive and a
 * circuit breaker — and resolves with stdout.
 *
 * Rejects with {@link RemoteExecError} (carrying stderr + exit code) when the
 * command exits non-zero, `NOT_FOUND` when the server row is gone,
 * `PRECONDITION_FAILED` when it has no SSH key or the server's breaker is
 * open, and the raw ssh2 error when the handshake fails.
 */
export async function execAsyncRemote(
	serverId: string,
	command: string,
	options: { timeoutMs?: number } = {},
): Promise<string> {
	const lease = await acquireSsh(serverId);
	return await runRemote(lease, command, { timeoutMs: options.timeoutMs });
}

/**
 * Like {@link execAsync} / {@link execAsyncRemote}, but writes `stdin` to the
 * process before closing the stream. Used so DB passwords never appear on
 * argv, and so file payloads (certificates, drop archives, SSH keys) are not
 * bounded by the 128 KiB `MAX_ARG_STRLEN` cap of a single shell argument.
 */
export async function execAsyncWithStdin(
	command: string,
	stdin: string | Buffer,
	options: ExecOptions & { serverId?: string | null } = {},
): Promise<string> {
	const { serverId, ...localOptions } = options;
	if (serverId) {
		return await execAsyncRemoteWithStdin(serverId, command, stdin, {
			timeoutMs: localOptions.timeout,
		});
	}
	const timeoutMs = localCommandTimeoutMs(localOptions.timeout);
	const result = await runLocal(command, {
		cwd: localOptions.cwd,
		env: localOptions.env,
		stdin,
		timeoutMs,
	});
	if (result.timedOut) throw new CommandTimeoutError(command, timeoutMs);
	if (result.code === 0 || result.code === null) return result.stdout;
	throw new Error(
		`"${commandLabel(command)}" failed (exit ${result.code})${result.stderr ? `: ${result.stderr.slice(0, 200)}` : ""}`,
	);
}

/**
 * SSH variant of {@link execAsyncWithStdin}: `stdin` is streamed over the
 * channel. Bounded by {@link remoteCommandTimeoutMs} like every other remote
 * command — on timeout the channel is closed and the call rejects (the pooled
 * connection stays up for the server's other commands).
 */
export async function execAsyncRemoteWithStdin(
	serverId: string,
	command: string,
	stdin: string | Buffer,
	options: { timeoutMs?: number } = {},
): Promise<string> {
	const lease = await acquireSsh(serverId);
	return await runRemote(lease, command, { timeoutMs: options.timeoutMs, stdin });
}
