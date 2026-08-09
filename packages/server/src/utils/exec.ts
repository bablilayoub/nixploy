import { exec, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import { db } from "../db";
import { servers } from "../db/schema";
import { getSshKeysPath } from "../modules/deployment/paths";

const execPromise = promisify(exec);

/** 50 MB — build/deploy logs can be large. */
const MAX_BUFFER = 1024 * 1024 * 50;
const SSH_READY_TIMEOUT_MS = 30_000;

/** Default hard timeout for long-running SSH commands (builds, pulls). */
export const DEFAULT_REMOTE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Resolve the remote command timeout: explicit override, then
 * `NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS`, then {@link DEFAULT_REMOTE_TIMEOUT_MS}.
 */
export function remoteCommandTimeoutMs(override?: number): number {
	if (override && override > 0) return override;
	const fromEnv = Number.parseInt(process.env.NIXPLOY_REMOTE_COMMAND_TIMEOUT_MS ?? "", 10);
	return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_REMOTE_TIMEOUT_MS;
}

export interface ExecOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeout?: number;
}

/**
 * Run a shell command on the Nixploy host. Resolves with stdout.
 * Every docker/shell operation in the platform goes through this or
 * {@link execAsyncRemote} so local and remote servers are interchangeable.
 */
export async function execAsync(command: string, options: ExecOptions = {}): Promise<string> {
	const { stdout } = await execPromise(command, {
		cwd: options.cwd,
		env: options.env ? { ...process.env, ...options.env } : process.env,
		timeout: options.timeout,
		maxBuffer: MAX_BUFFER,
	});
	return stdout.toString();
}

export class RemoteExecError extends Error {
	constructor(
		message: string,
		public readonly stderr: string,
		public readonly code: number | null,
	) {
		super(message);
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
 * Trust-on-first-use host key pinning for managed servers.
 * Keys live under `<configDir>/ssh/known_hosts/<serverId>.pub`.
 */
export function verifyRemoteHostKey(serverId: string, key: Buffer): boolean {
	const dir = path.join(getSshKeysPath(), "known_hosts");
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${serverId}.pub`);
	const encoded = key.toString("base64");
	if (existsSync(file)) {
		return readFileSync(file, "utf8").trim() === encoded;
	}
	writeFileSync(file, `${encoded}\n`, { mode: 0o600 });
	return true;
}

/** Clear a pinned host key (e.g. after intentional server rebuild). */
export function clearRemoteHostKey(serverId: string): void {
	const file = path.join(getSshKeysPath(), "known_hosts", `${serverId}.pub`);
	try {
		unlinkSync(file);
	} catch {
		// missing is fine
	}
}

/**
 * Run a shell command on a remote managed server over SSH (ssh2).
 * Looks up the server row (and its SSH key) by `serverId`, opens a
 * short-lived connection, streams the command, and resolves with stdout.
 * Rejects with {@link RemoteExecError} (carrying stderr + exit code) when
 * the command exits non-zero.
 */
export async function execAsyncRemote(
	serverId: string,
	command: string,
	options: { timeoutMs?: number } = {},
): Promise<string> {
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

	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);

	return new Promise<string>((resolve, reject) => {
		const conn = new Client();
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		const fail = (error: Error) =>
			finish(() => {
				conn.end();
				reject(error);
			});

		// Hard command timeout — a wedged remote command must not pin the
		// connection (and the caller) forever.
		const timer = setTimeout(() => {
			fail(
				new RemoteExecError(
					`Remote "${commandLabel(command)}" timed out after ${Math.round(timeoutMs / 1000)}s on server ${server.name}`,
					stderr,
					null,
				),
			);
		}, timeoutMs);
		timer.unref?.();

		conn
			.on("ready", () => {
				conn.exec(command, (err, stream) => {
					if (err) {
						fail(err);
						return;
					}
					stream
						.on("close", (code: number | null) => {
							finish(() => {
								conn.end();
								if (code === 0 || code === null) {
									resolve(stdout);
								} else {
									reject(
										new RemoteExecError(
											`Remote "${commandLabel(command)}" failed (exit ${code}) on server ${server.name}`,
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
				});
			})
			.on("error", (err) => {
				// Always close the connection — an SSH error after `ready`
				// otherwise leaks the socket.
				fail(err);
			})
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

/**
 * Like {@link execAsync} / {@link execAsyncRemote}, but writes `stdin` to the
 * process before closing the stream. Used so DB passwords never appear on argv.
 */
export async function execAsyncWithStdin(
	command: string,
	stdin: string,
	options: ExecOptions & { serverId?: string | null } = {},
): Promise<string> {
	const { serverId, ...localOptions } = options;
	if (serverId) {
		return await execAsyncRemoteWithStdin(serverId, command, stdin);
	}
	return await new Promise<string>((resolve, reject) => {
		const child = spawn("sh", ["-c", command], {
			cwd: localOptions.cwd,
			env: localOptions.env ? { ...process.env, ...localOptions.env } : process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});
		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0 || code === null) resolve(stdout);
			else
				reject(
					new Error(
						`"${commandLabel(command)}" failed (exit ${code})${stderr ? `: ${stderr.slice(0, 200)}` : ""}`,
					),
				);
		});
		child.stdin.write(stdin);
		child.stdin.end();
	});
}

async function execAsyncRemoteWithStdin(
	serverId: string,
	command: string,
	stdin: string,
): Promise<string> {
	const server = await db.query.servers.findFirst({
		where: eq(servers.serverId, serverId),
		with: { sshKey: true },
	});
	if (!server) throw new Error(`Server not found: ${serverId}`);
	const sshKey = server.sshKey;
	if (!sshKey) {
		throw new Error(`Server ${server.name} (${serverId}) has no SSH key attached`);
	}

	return new Promise<string>((resolve, reject) => {
		const conn = new Client();
		let stdout = "";
		let stderr = "";
		conn
			.on("ready", () => {
				conn.exec(command, (err, stream) => {
					if (err) {
						conn.end();
						reject(err);
						return;
					}
					stream
						.on("close", (code: number | null) => {
							conn.end();
							if (code === 0 || code === null) resolve(stdout);
							else
								reject(
									new RemoteExecError(
										`Remote "${commandLabel(command)}" failed (exit ${code}) on server ${server.name}`,
										stderr,
										code,
									),
								);
						})
						.on("data", (data: Buffer) => {
							stdout += data.toString();
						});
					stream.stderr.on("data", (data: Buffer) => {
						stderr += data.toString();
					});
					stream.write(stdin);
					stream.end();
				});
			})
			.on("error", (err) => {
				conn.end();
				reject(err);
			})
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
