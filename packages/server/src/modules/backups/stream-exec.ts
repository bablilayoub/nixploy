import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { ClientChannel } from "ssh2";
import { remoteCommandTimeoutMs, terminateProcessTree } from "../../utils/exec";
import { acquireSsh } from "../../utils/ssh-pool";

/**
 * Streaming exec for backups.
 *
 * `utils/exec.ts` buffers a command's whole stdout in a string, which is what
 * capped dumps at ~37 MB (architecture audit #18). Backups need the bytes as
 * a stream instead: `docker exec … pg_dump | gzip` on one end, an S3
 * multipart upload (or a file) on the other, with nothing but 8 MiB parts in
 * memory. Restores run the same shape in reverse.
 *
 * This is the only place in the module that touches `child_process` directly;
 * it mirrors `utils/exec.ts`'s contract (detached process group, hard
 * timeout, and — over SSH — a channel on the server's pooled connection from
 * `utils/ssh-pool.ts`) and should move there if a second subsystem ever needs
 * streaming.
 */

export interface StreamingCommand {
	/** Raw stdout. Consume it — the command stalls once the pipe buffer fills. */
	stdout: Readable;
	/**
	 * Resolves with the captured stderr once the command exits 0; rejects when
	 * it exits non-zero, times out or the transport fails. Await it AFTER
	 * stdout has been drained.
	 */
	done: Promise<string>;
	/** Kill the command (used when the consumer fails mid-stream). */
	abort(): void;
}

export interface StreamingOptions {
	/** Fed to the command's stdin and closed; nothing is written when omitted. */
	stdin?: Readable | Buffer | string;
	timeoutMs?: number;
	/** Cap on captured stderr (default 64 KiB) — it only carries the trailer. */
	maxStderrBytes?: number;
}

const DEFAULT_MAX_STDERR = 64 * 1024;

function writeStdin(target: NodeJS.WritableStream, stdin: StreamingOptions["stdin"]): void {
	if (stdin === undefined) {
		target.end();
		return;
	}
	if (typeof stdin === "string" || Buffer.isBuffer(stdin)) {
		target.end(stdin);
		return;
	}
	stdin.pipe(target);
}

function runLocalStreaming(command: string, options: StreamingOptions): StreamingCommand {
	const child = spawn("sh", ["-c", command], {
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
	});
	const maxStderr = options.maxStderrBytes ?? DEFAULT_MAX_STDERR;
	let stderr = "";
	let timedOut = false;
	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);
	const timer = setTimeout(() => {
		timedOut = true;
		terminateProcessTree(child);
	}, timeoutMs);
	timer.unref?.();

	child.stderr.on("data", (chunk: Buffer) => {
		if (stderr.length < maxStderr) stderr += chunk.toString();
	});
	// EPIPE when the command exits before reading all of stdin.
	child.stdin.on("error", () => {});
	writeStdin(child.stdin, options.stdin);

	const done = new Promise<string>((resolve, reject) => {
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (timedOut) {
				reject(new Error(`Backup command timed out after ${Math.round(timeoutMs / 1000)}s`));
				return;
			}
			if (code === 0 || code === null) resolve(stderr);
			else
				reject(
					new Error(
						`Backup command failed (exit ${code})${stderr ? `: ${stderr.slice(0, 200)}` : ""}`,
					),
				);
		});
	});

	return { stdout: child.stdout, done, abort: () => terminateProcessTree(child) };
}

async function runRemoteStreaming(
	serverId: string,
	command: string,
	options: StreamingOptions,
): Promise<StreamingCommand> {
	const lease = await acquireSsh(serverId);
	const serverName = lease.server.name;
	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);
	const maxStderr = options.maxStderrBytes ?? DEFAULT_MAX_STDERR;

	return await new Promise<StreamingCommand>((resolveCommand, rejectCommand) => {
		let stderr = "";
		let settled = false;
		let channel: ClientChannel | null = null;
		let resolveDone: (value: string) => void = () => {};
		let rejectDone: (reason: Error) => void = () => {};
		const done = new Promise<string>((resolve, reject) => {
			resolveDone = resolve;
			rejectDone = reject;
		});
		// `done` is rejected by the transport even when the outer promise never
		// resolved (connection lost before the channel opened), i.e. before any
		// caller can await it. A no-op handler keeps that from crashing the
		// process; the rejection still reaches whoever awaits `done` later.
		void done.catch(() => {});

		/**
		 * Close this command's channel only — the connection is shared with every
		 * other command on the server, so ending it would abort them too.
		 */
		const closeChannel = () => {
			if (channel) {
				try {
					channel.close();
				} catch {
					// channel already gone
				}
			}
			lease.release();
		};
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};

		const timer = setTimeout(() => {
			settle(() => {
				closeChannel();
				rejectDone(new Error(`Backup command timed out after ${Math.round(timeoutMs / 1000)}s`));
			});
		}, timeoutMs);
		timer.unref?.();

		lease.onConnectionLost((error) => {
			settle(() => {
				rejectDone(error);
				rejectCommand(error);
			});
		});

		lease.client.exec(command, (err, stream) => {
			if (err) {
				clearTimeout(timer);
				// The connection could not open a session: it is the transport that
				// failed, so drop it instead of handing it to the next caller.
				lease.discard(err);
				rejectCommand(err);
				return;
			}
			channel = stream;
			// The pool slot follows the channel, whatever settles `done` first.
			stream.once("close", () => lease.release());
			stream.stderr.on("data", (chunk: Buffer) => {
				if (stderr.length < maxStderr) stderr += chunk.toString();
			});
			stream.on("close", (code: number | null) => {
				settle(() => {
					if (code === 0 || code === null) resolveDone(stderr);
					else
						rejectDone(
							new Error(
								`Backup command failed (exit ${code}) on server ${serverName}${
									stderr ? `: ${stderr.slice(0, 200)}` : ""
								}`,
							),
						);
				});
			});
			stream.on("error", (error: Error) => {
				settle(() => {
					closeChannel();
					rejectDone(error);
				});
			});
			writeStdin(stream, options.stdin);
			resolveCommand({
				stdout: stream as unknown as Readable,
				done,
				abort: closeChannel,
			});
		});
	});
}

/** Run `command` on the Nixploy host or a managed server, streaming stdout. */
export async function spawnStreamingCommand(
	serverId: string | null | undefined,
	command: string,
	options: StreamingOptions = {},
): Promise<StreamingCommand> {
	return serverId
		? await runRemoteStreaming(serverId, command, options)
		: runLocalStreaming(command, options);
}
