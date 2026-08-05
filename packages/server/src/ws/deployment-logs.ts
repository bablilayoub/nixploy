import { readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import type { WebSocket } from "ws";
import { db } from "../db";
import { deployments } from "../db/schema";
// Shared contract with the deploy engine (modules/deployment). The module is
// built in parallel; until it lands this import is the agreed interface:
// `deploymentEvents` emits 'log' { deploymentId, chunk } and 'finish' { deploymentId, status }.
import { deploymentEvents } from "../modules/deployment";
import type { WsSession } from "./auth";
import { closeWithError, sendJson, upgradeSearchParams } from "./utils";

/**
 * /ws/deployment?deploymentId=<id>
 *
 * Replays the accumulated deploy log (stored on disk at the deployment row's
 * logPath), then live-follows `deploymentEvents` until the matching 'finish'.
 * Frames: { type: "log", message } | { type: "finish", status }.
 */
export async function handleDeploymentLogs(
	ws: WebSocket,
	req: IncomingMessage,
	_session: WsSession,
): Promise<void> {
	const deploymentId = upgradeSearchParams(req).get("deploymentId");
	if (!deploymentId) {
		closeWithError(ws, "Missing deploymentId query parameter");
		return;
	}

	// Subscribe before reading the log file so no chunk is lost between replay and follow.
	let replaying = true;
	let finishedStatus: string | null = null;
	const pending: string[] = [];

	const onLog = (payload: { deploymentId: string; chunk: string }) => {
		if (payload.deploymentId !== deploymentId) return;
		if (replaying) {
			pending.push(payload.chunk);
		} else {
			sendJson(ws, { type: "log", message: payload.chunk });
		}
	};
	const onFinish = (payload: { deploymentId: string; status: string }) => {
		if (payload.deploymentId !== deploymentId) return;
		if (replaying) {
			finishedStatus = payload.status;
		} else {
			sendJson(ws, { type: "finish", status: payload.status });
			cleanup();
			ws.close(1000);
		}
	};
	const cleanup = () => {
		deploymentEvents.off("log", onLog);
		deploymentEvents.off("finish", onFinish);
	};

	deploymentEvents.on("log", onLog);
	deploymentEvents.on("finish", onFinish);
	ws.on("close", cleanup);

	try {
		const deployment = await db.query.deployments.findFirst({
			where: eq(deployments.deploymentId, deploymentId),
		});
		if (!deployment) {
			cleanup();
			closeWithError(ws, `Deployment not found: ${deploymentId}`);
			return;
		}

		let accumulated = "";
		try {
			accumulated = await readFile(deployment.logPath, "utf8");
		} catch {
			// Log file not created yet (job still queued) — replay nothing.
		}
		if (accumulated) {
			sendJson(ws, { type: "log", message: accumulated });
		}

		replaying = false;
		for (const chunk of pending) {
			sendJson(ws, { type: "log", message: chunk });
		}
		pending.length = 0;

		// The deploy may have finished before (or while) we replayed.
		const status = finishedStatus ?? (deployment.status !== "running" ? deployment.status : null);
		if (status) {
			sendJson(ws, { type: "finish", status });
			cleanup();
			ws.close(1000);
		}
	} catch (error) {
		cleanup();
		closeWithError(ws, error instanceof Error ? error.message : "Failed to load deployment");
	}
}
