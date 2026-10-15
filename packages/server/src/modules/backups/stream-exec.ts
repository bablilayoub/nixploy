import { spawn } from "node:child_process";
import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
	/** Local process environment; credentials stay off argv. */
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	/** Cap on captured stderr (default 64 KiB) — it only carries the trailer. */
	maxStderrBytes?: number;
}

const DEFAULT_MAX_STDERR = 64 * 1024;

function writeStdin(target: Writable, stdin: StreamingOptions["stdin"]): Promise<void> {
	const source =
		stdin instanceof Readable ? stdin : Readable.from(stdin === undefined ? [] : [stdin]);
	return pipeline(source, target);
}

function runLocalStreaming(command: string, options: StreamingOptions): StreamingCommand {
	const child = spawn("sh", ["-c", command], {
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
		env: options.env ? { ...process.env, ...options.env } : process.env,
	});
	const maxStderr = options.maxStderrBytes ?? DEFAULT_MAX_STDERR;
	let stderr = "";
	let timedOut = false;
	let aborted = false;
	const timeoutMs = remoteCommandTimeoutMs(options.timeoutMs);
	const timer = setTimeout(() => {
		timedOut = true;
		terminateProcessTree(child);
	}, timeoutMs);
	timer.unref?.();

	child.stderr.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString()).slice(-maxStderr);
	});
	const inputDone = writeStdin(child.stdin, options.stdin);
	void inputDone.catch(() => terminateProcessTree(child));

	const exited = new Promise<string>((resolve, reject) => {
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (aborted) {
				reject(new Error("Backup command aborted"));
				return;
			}
			if (timedOut) {
				reject(new Error(`Backup command timed out after ${Math.round(timeoutMs / 1000)}s`));
				return;
			}
			if (code === 0) resolve(stderr);
			else
				reject(
					new Error(
						`Backup command failed (exit ${code}${signal ? `, signal ${signal}` : ""})${stderr ? `: ${stderr.slice(0, 200)}` : ""}`,
					),
				);
		});
	});
	const done = Promise.all([exited, inputDone]).then(([output]) => output);
	void done.catch(() => {});

	return {
		stdout: child.stdout,
		done,
		abort: () => {
			aborted = true;
			terminateProcessTree(child);
		},
	};
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
				stderr = (stderr + chunk.toString()).slice(-maxStderr);
			});
			const inputDone = writeStdin(stream, options.stdin);
			void inputDone.catch((error: Error) => {
				settle(() => {
					closeChannel();
					rejectDone(error);
				});
			});
			stream.on("close", (code: number | null) => {
				settle(() => {
					if (code === 0) void inputDone.then(() => resolveDone(stderr), rejectDone);
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
			resolveCommand({
				stdout: stream as unknown as Readable,
				done,
				abort: () =>
					settle(() => {
						closeChannel();
						rejectDone(new Error("Backup command aborted"));
					}),
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
	options.signal?.throwIfAborted();
	const commandProcess = serverId
		? await runRemoteStreaming(serverId, command, options)
		: runLocalStreaming(command, options);
	const abort = () => commandProcess.abort();
	options.signal?.addEventListener("abort", abort, { once: true });
	if (options.signal?.aborted) abort();
	void commandProcess.done
		.finally(() => options.signal?.removeEventListener("abort", abort))
		.catch(() => {});
	return commandProcess;
}
