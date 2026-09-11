import { open, stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { eq } from "drizzle-orm";
import type { WebSocket } from "ws";
import { db } from "../db";
import { deployments } from "../db/schema";
// Shared contract with the deploy engine (modules/deployment).
// `deploymentEvents` emits 'log' { deploymentId, chunk } per appended chunk
// and 'finish' { deploymentId, status } when a job ends.
import { deploymentEvents } from "../modules/deployment";
import { assertWsDeploymentAccess, resolveWsOrganizationId } from "./access";
import type { WsSession } from "./auth";
import { closeWithError, sendJson, upgradeSearchParams } from "./utils";

/** Fallback status check, only for a `finish` event that never arrives. */
const STATUS_POLL_MS = 5_000;
/** Log events arrive per chunk; coalesce a burst into one read. */
const FLUSH_DEBOUNCE_MS = 20;
/** Bytes per frame while replaying/following. */
const READ_CHUNK_BYTES = 256 * 1024;

const isActive = (status: string): boolean => status === "running" || status === "queued";

/**
 * /ws/deployment?deploymentId=<id>
 *
 * Streams the deploy log from disk (replay + follow) and closes when the
 * deployment leaves `queued`/`running`. The file is the source of truth: the
 * follower keeps a byte offset and reads only what was appended since
 * (`fs.stat` size + positional `read`), woken by the in-process `log` event
 * `DeploymentLogger.write` emits — no 500 ms re-read of the whole file and no
 * per-client DB poll. A slow status poll remains as a safety net in case the
 * `finish` event is missed.
 *
 * Frames: { type: "log", message } | { type: "finish", status }.
 */
export async function handleDeploymentLogs(
	ws: WebSocket,
	req: IncomingMessage,
	session: WsSession,
): Promise<void> {
	const deploymentId = upgradeSearchParams(req).get("deploymentId");
	if (!deploymentId) {
		closeWithError(ws, "Missing deploymentId query parameter");
		return;
	}

	let logPath: string | null = null;
	let offset = 0;
	let closed = false;
	let statusTimer: ReturnType<typeof setInterval> | null = null;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let inflight: Promise<void> | null = null;
	let again = false;
	// Carries a multi-byte UTF-8 sequence split across two reads.
	const decoder = new StringDecoder("utf8");

	const cleanup = () => {
		closed = true;
		if (statusTimer) {
			clearInterval(statusTimer);
			statusTimer = null;
		}
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		deploymentEvents.off("finish", onFinish);
		deploymentEvents.off("log", onLog);
	};

	const finishAndClose = (status: string) => {
		if (closed) return;
		closed = true;
		sendJson(ws, { type: "finish", status });
		cleanup();
		ws.close(1000);
	};

	/** Send every byte appended since `offset`, in bounded frames. */
	const readNewBytes = async () => {
		if (closed || !logPath) return;
		let size: number;
		try {
			size = (await stat(logPath)).size;
		} catch {
			return; // Log file may not exist yet while the job is still queued.
		}
		if (size <= offset) return;
		const handle = await open(logPath, "r");
		try {
			const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
			while (offset < size && !closed) {
				const { bytesRead } = await handle.read(
					buffer,
					0,
					Math.min(buffer.length, size - offset),
					offset,
				);
				if (bytesRead === 0) break;
				offset += bytesRead;
				const text = decoder.write(buffer.subarray(0, bytesRead));
				if (text) sendJson(ws, { type: "log", message: text });
			}
		} finally {
			await handle.close();
		}
	};

	/**
	 * Single-flight flush: concurrent wake-ups collapse into one extra pass,
	 * and every caller gets a promise that resolves once the bytes it saw
	 * appended have been sent.
	 */
	const flush = (): Promise<void> => {
		if (inflight) {
			again = true;
			return inflight;
		}
		inflight = (async () => {
			try {
				do {
					again = false;
					await readNewBytes();
				} while (again && !closed);
			} catch {
				// Transient read error — the next wake-up retries from `offset`.
			} finally {
				inflight = null;
			}
		})();
		return inflight;
	};

	const scheduleFlush = () => {
		if (closed || flushTimer) return;
		flushTimer = setTimeout(() => {
			flushTimer = null;
			void flush();
		}, FLUSH_DEBOUNCE_MS);
	};

	const onLog = (payload: { deploymentId: string }) => {
		if (payload.deploymentId === deploymentId) scheduleFlush();
	};

	const onFinish = (payload: { deploymentId: string; status: string }) => {
		if (payload.deploymentId !== deploymentId) return;
		void flush().then(() => finishAndClose(payload.status));
	};

	deploymentEvents.on("finish", onFinish);
	deploymentEvents.on("log", onLog);
	ws.on("close", cleanup);

	try {
		const organizationId = await resolveWsOrganizationId(session);
		const deployment = await assertWsDeploymentAccess(deploymentId, organizationId);
		logPath = deployment.logPath;

		await flush();

		if (!isActive(deployment.status)) {
			finishAndClose(deployment.status);
			return;
		}

		statusTimer = setInterval(() => {
			void (async () => {
				if (closed) return;
				try {
					const [row] = await db
						.select({ status: deployments.status })
						.from(deployments)
						.where(eq(deployments.deploymentId, deploymentId))
						.limit(1);
					if (row && !isActive(row.status)) {
						await flush();
						finishAndClose(row.status);
					}
				} catch {
					// Ignore transient DB errors during follow.
				}
			})();
		}, STATUS_POLL_MS);
	} catch (error) {
		cleanup();
		closeWithError(ws, error instanceof Error ? error.message : "Failed to load deployment");
	}
}
