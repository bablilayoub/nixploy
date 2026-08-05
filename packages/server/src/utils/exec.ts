import { exec } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import { db } from "../db";
import { servers } from "../db/schema";

const execPromise = promisify(exec);

/** 50 MB — build/deploy logs can be large. */
const MAX_BUFFER = 1024 * 1024 * 50;
const SSH_READY_TIMEOUT_MS = 30_000;

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
 * Run a shell command on a remote managed server over SSH (ssh2).
 * Looks up the server row (and its SSH key) by `serverId`, opens a
 * short-lived connection, streams the command, and resolves with stdout.
 * Rejects with {@link RemoteExecError} (carrying stderr + exit code) when
 * the command exits non-zero.
 */
export async function execAsyncRemote(serverId: string, command: string): Promise<string> {
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
						})
						.on("data", (data: Buffer) => {
							stdout += data.toString();
						});
					stream.stderr.on("data", (data: Buffer) => {
						stderr += data.toString();
					});
				});
			})
			.on("error", (err) => {
				reject(err);
			})
			.connect({
				host: server.ipAddress,
				port: server.port,
				username: server.username,
				privateKey: sshKey.privateKey,
				readyTimeout: SSH_READY_TIMEOUT_MS,
			});
	});
}
