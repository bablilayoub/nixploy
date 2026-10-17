import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";
import { createLogger } from "../lib/logger";
import { bestEffort } from "../utils/best-effort";
import { closeWithError, safeSend, sendJson } from "./utils";

interface ActiveTerminalExec {
	cancel: () => void;
	forceClose: () => void;
	done: Promise<void>;
}

interface TerminalCleanupState {
	executions: Set<ActiveTerminalExec>;
	attachments: Set<Promise<void>>;
	draining: boolean;
	failures: number;
}

// The custom server and Next's bundled module must share shutdown ownership.
const globalForTerminal = globalThis as typeof globalThis & {
	__nixployTerminalCleanup?: TerminalCleanupState;
};
const cleanupState: TerminalCleanupState = globalForTerminal.__nixployTerminalCleanup ?? {
	executions: new Set(),
	attachments: new Set(),
	draining: false,
	failures: 0,
};
globalForTerminal.__nixployTerminalCleanup = cleanupState;
const log = createLogger("terminal-cleanup");

/** Include asynchronous exec starts and late SSH callbacks in graceful shutdown. */
export function trackTerminalAttachment<T>(attachment: Promise<T>): Promise<T> {
	const settled = attachment.then(
		() => {},
		() => {},
	);
	cleanupState.attachments.add(settled);
	void settled.then(() => cleanupState.attachments.delete(settled));
	return attachment;
}

/** Cancel owned sessions and wait for identity readers and exact-process cleanup, bounded. */
export async function drainTerminalExecs(timeoutMs = 6_000): Promise<{
	timedOut: boolean;
	pendingExecutions: number;
	pendingAttachments: number;
	failed: number;
}> {
	const previousFailures = cleanupState.failures;
	cleanupState.draining = true;
	let deadline: ReturnType<typeof setTimeout> | null = null;
	const idle = async () => {
		while (cleanupState.executions.size > 0 || cleanupState.attachments.size > 0) {
			for (const execution of cleanupState.executions) execution.cancel();
			await Promise.all([
				...Array.from(cleanupState.executions, (execution) => execution.done),
				...cleanupState.attachments,
			]);
		}
	};
	try {
		const timedOut = await Promise.race([
			idle().then(() => false),
			new Promise<boolean>((resolve) => {
				deadline = setTimeout(() => resolve(true), timeoutMs);
			}),
		]);
		const result = {
			timedOut,
			pendingExecutions: cleanupState.executions.size,
			pendingAttachments: cleanupState.attachments.size,
			failed: cleanupState.failures - previousFailures,
		};
		if (timedOut || result.failed > 0) {
			log.error("Terminal cleanup did not complete cleanly before shutdown", result);
		}
		if (timedOut) {
			for (const execution of cleanupState.executions) execution.forceClose();
		}
		return result;
	} finally {
		if (deadline) clearTimeout(deadline);
		cleanupState.draining = false;
	}
}

export interface TerminalExecIdentity {
	pid: string;
	startTime: string;
}

/** Read the PID in the container namespace, before exec preserves it as the shell. */
export function terminalExecCommand(nonce: string, shell: string): string {
	if (!/^[a-zA-Z0-9-]+$/.test(nonce)) throw new Error("Invalid terminal nonce");
	return `IFS= read -r stat < /proc/$$/stat || exit 70; rest=\${stat##*) }; set -f; set -- $rest; [ "$#" -ge 20 ] || exit 70; shift 19; printf '\\036NIXPLOY:${nonce}:%s:%s\\037' "$$" "$1"; ${shell}`;
}

/** A stale namespace PID must never target a replacement process or container init. */
export function terminalSignalCommand(
	identity: TerminalExecIdentity,
	signal: "HUP" | "KILL",
): string[] {
	if (!/^[0-9]+$/.test(identity.pid) || BigInt(identity.pid) <= 1n) {
		throw new Error("Invalid terminal process identity");
	}
	if (!/^[0-9]+$/.test(identity.startTime)) throw new Error("Invalid terminal start time");
	return [
		"sh",
		"-c",
		`pid=$1; expected=$2; signal=$3; [ -r "/proc/$pid/stat" ] || exit 0; IFS= read -r stat < "/proc/$pid/stat" || exit 0; rest=\${stat##*) }; set -f; set -- $rest; [ "$#" -ge 20 ] || exit 0; shift 19; [ "$1" = "$expected" ] || exit 0; kill "-$signal" "$pid"`,
		"nixploy-terminal-close",
		identity.pid,
		identity.startTime,
		signal,
	];
}

/**
 * Docker detaches an exec when its stream closes. Keep its namespace identity
 * private, then stop that exact process on every close path. A late startup
 * marker is still consumed after browser cancellation so its exec can be closed.
 */
export function attachTerminalExec({
	ws,
	stream,
	nonce,
	closeTransport,
	signal,
}: {
	ws: WebSocket;
	stream: Duplex;
	nonce: string;
	closeTransport: () => void;
	signal: (identity: TerminalExecIdentity, signal: "HUP" | "KILL") => Promise<void>;
}): { isReady: () => boolean } {
	const prefix = `\x1eNIXPLOY:${nonce}:`;
	let pending = Buffer.alloc(0);
	let identity: TerminalExecIdentity | null = null;
	let cancelled = ws.readyState !== ws.OPEN;
	let stopping = false;
	let transportClosed = false;
	let finished = false;
	let failed = false;
	let readerCloseTimer: ReturnType<typeof setTimeout> | null = null;
	let resolveDone!: () => void;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	let execution: ActiveTerminalExec | null = null;
	const finish = () => {
		if (finished) return;
		finished = true;
		if (readerCloseTimer) clearTimeout(readerCloseTimer);
		readerCloseTimer = null;
		if (failed) cleanupState.failures += 1;
		if (execution) cleanupState.executions.delete(execution);
		resolveDone();
	};
	const close = () => {
		if (transportClosed) return;
		transportClosed = true;
		if (!identity) {
			readerCloseTimer = setTimeout(() => {
				if (finished || identity) return;
				failed = true;
				pending = Buffer.alloc(0);
				log.error("Terminal identity reader did not close after transport cancellation");
				finish();
			}, 1_000);
			readerCloseTimer.unref();
		}
		void bestEffort("Close terminal transport", async () => {
			try {
				closeTransport();
			} catch (error) {
				failed = true;
				throw error;
			}
		});
	};
	const stop = () => {
		if (!identity || stopping) return;
		stopping = true;
		const owned = identity;
		close();
		void bestEffort(
			"Close terminal exec",
			async () => {
				await bestEffort("Hang up terminal exec", () => signal(owned, "HUP"));
				await new Promise<void>((resolve) => setTimeout(resolve, 150));
				// The start-time guard also applies to the fallback after a normal exit.
				try {
					await signal(owned, "KILL");
				} catch (error) {
					failed = true;
					throw error;
				}
			},
			"error",
		).then(finish);
	};
	const startup = setTimeout(() => {
		cancelled = true;
		failed = true;
		closeWithError(ws, "The terminal did not identify its shell. Start a new session to retry.");
		close();
	}, 5_000);
	startup.unref();
	const cancel = () => {
		cancelled = true;
		if (identity) {
			clearTimeout(startup);
			stop();
		}
	};
	ws.once("close", cancel);
	stream.on("data", (chunk: Buffer) => {
		if (finished && !identity) return;
		if (identity) {
			if (!cancelled) safeSend(ws, chunk);
			return;
		}
		pending = Buffer.concat([pending, Buffer.from(chunk)]);
		const begin = pending.indexOf(prefix);
		const end = begin < 0 ? -1 : pending.indexOf(0x1f, begin + prefix.length);
		if (end < 0) {
			if (pending.length > 4096) {
				pending = pending.subarray(-4096);
				clearTimeout(startup);
				cancelled = true;
				failed = true;
				closeWithError(ws, "Could not identify the terminal shell");
				close();
			}
			return;
		}
		const fields = pending.subarray(begin + prefix.length, end).toString();
		const match = /^([0-9]{1,10}):([0-9]{1,20})$/.exec(fields);
		if (!match || BigInt(match[1] ?? "0") <= 1n) {
			pending = pending.subarray(end + 1).subarray(-4096);
			clearTimeout(startup);
			cancelled = true;
			failed = true;
			closeWithError(ws, "Invalid terminal shell identity");
			close();
			return;
		}
		identity = { pid: match[1] as string, startTime: match[2] as string };
		if (readerCloseTimer) clearTimeout(readerCloseTimer);
		readerCloseTimer = null;
		clearTimeout(startup);
		const output = pending.subarray(end + 1);
		pending = Buffer.alloc(0);
		if (cancelled || ws.readyState !== ws.OPEN) {
			cancel();
			return;
		}
		sendJson(ws, { type: "ready" });
		if (output.length > 0) safeSend(ws, output);
	});
	const ended = (code: number) => {
		clearTimeout(startup);
		if (!identity && code === 1011) failed = true;
		if (!identity && !cancelled) {
			sendJson(ws, { type: "error", message: "The terminal shell closed before it became ready." });
		}
		cancel();
		close();
		if (!identity) finish();
		ws.close(code);
	};
	stream.on("error", () => ended(1011));
	stream.once("end", () => ended(1000));
	stream.once("close", () => ended(1000));
	execution = {
		cancel,
		forceClose: () => {
			cancelled = true;
			failed = true;
			clearTimeout(startup);
			close();
			if (!stopping) finish();
		},
		done,
	};
	if (!finished) cleanupState.executions.add(execution);
	if (cleanupState.draining) cancel();
	return { isReady: () => identity !== null && !cancelled };
}
