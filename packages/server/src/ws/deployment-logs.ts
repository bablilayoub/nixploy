import { readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import type { WebSocket } from "ws";
import { db } from "../db";
import { deployments } from "../db/schema";
// Shared contract with the deploy engine (modules/deployment).
// `deploymentEvents` emits 'finish' { deploymentId, status } when a job ends.
import { deploymentEvents } from "../modules/deployment";
import { assertWsDeploymentAccess, resolveWsOrganizationId } from "./access";
import type { WsSession } from "./auth";
import { closeWithError, sendJson, upgradeSearchParams } from "./utils";

const FILE_POLL_MS = 500;

/**
 * /ws/deployment?deploymentId=<id>
 *
 * Streams the deploy log from disk (replay + follow) and closes when the
 * deployment leaves `running`. File polling is the source of truth for log
 * bytes so live updates work even when the custom server and Next request
 * graph do not share one EventEmitter instance. `finish` events still close
 * the socket promptly when the worker publishes them.
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
	let sentLength = 0;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let closed = false;

	const cleanup = () => {
		closed = true;
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		deploymentEvents.off("finish", onFinish);
	};

	const finishAndClose = (status: string) => {
		if (closed) return;
		closed = true;
		sendJson(ws, { type: "finish", status });
		cleanup();
		ws.close(1000);
	};

	const flushLog = async () => {
		if (closed || !logPath) return;
		try {
			const contents = await readFile(logPath, "utf8");
			if (contents.length > sentLength) {
				const next = contents.slice(sentLength);
				sentLength = contents.length;
				sendJson(ws, { type: "log", message: next });
			}
		} catch {
			// Log file may not exist yet while the job is still queued.
		}
	};

	const onFinish = (payload: { deploymentId: string; status: string }) => {
		if (payload.deploymentId !== deploymentId) return;
		void flushLog().then(() => finishAndClose(payload.status));
	};

	deploymentEvents.on("finish", onFinish);
	ws.on("close", cleanup);

	try {
		const organizationId = await resolveWsOrganizationId(session);
		const deployment = await assertWsDeploymentAccess(deploymentId, organizationId);
		logPath = deployment.logPath;

		await flushLog();

		if (deployment.status !== "running") {
			finishAndClose(deployment.status);
			return;
		}

		pollTimer = setInterval(() => {
			void (async () => {
				if (closed) return;
				await flushLog();
				try {
					const [row] = await db
						.select({ status: deployments.status })
						.from(deployments)
						.where(eq(deployments.deploymentId, deploymentId))
						.limit(1);
					if (row && row.status !== "running") {
						await flushLog();
						finishAndClose(row.status);
					}
				} catch {
					// Ignore transient DB errors during follow.
				}
			})();
		}, FILE_POLL_MS);
	} catch (error) {
		cleanup();
		closeWithError(ws, error instanceof Error ? error.message : "Failed to load deployment");
	}
}
