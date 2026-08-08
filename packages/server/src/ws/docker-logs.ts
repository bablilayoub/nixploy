import type { IncomingMessage } from "node:http";
import { type Readable, Writable } from "node:stream";
import type { WebSocket } from "ws";
import { assertComposeContainerOwnership } from "../modules/compose/containers";
import { assertWsContainerAccess, assertWsDockerContainerAccess } from "./access";
import type { WsSession } from "./auth";
import {
	assertContainerNotProtected,
	connectToServer,
	getDocker,
	resolveLocalContainer,
	resolveLocalContainerById,
	resolveRemoteContainerId,
} from "./docker";
import {
	closeWithError,
	isValidAppName,
	isValidContainerId,
	safeSend,
	sendJson,
	upgradeSearchParams,
} from "./utils";

const DEFAULT_TAIL = 1000;

/**
 * /ws/logs?appName=<name>&serverId=<id?>&tail=<n?>
 * /ws/logs?appName=<name>&containerId=<id>&serverId=<id?>&tail=<n?>
 * /ws/logs?containerId=<id>&serverId=<id?>&tail=<n?>   (Docker control center)
 *
 * Streams `docker logs --follow` for the app's container. Frames are raw text
 * chunks (written straight into xterm.js); errors are JSON { type: "error" }.
 */
export async function handleDockerLogs(
	ws: WebSocket,
	req: IncomingMessage,
	session: WsSession,
): Promise<void> {
	const params = upgradeSearchParams(req);
	const appName = params.get("appName");
	const containerId = params.get("containerId");
	const serverId = params.get("serverId");
	const tailParam = Number.parseInt(params.get("tail") ?? "", 10);
	const tail =
		Number.isFinite(tailParam) && tailParam > 0 ? Math.min(tailParam, 10_000) : DEFAULT_TAIL;

	if (containerId) {
		if (!isValidContainerId(containerId)) {
			closeWithError(ws, "Missing or invalid containerId query parameter");
			return;
		}

		if (appName) {
			if (!isValidAppName(appName)) {
				closeWithError(ws, "Missing or invalid appName query parameter");
				return;
			}
			try {
				await assertWsContainerAccess(session, appName, serverId);
				await assertComposeContainerOwnership(appName, containerId, serverId);
				if (serverId) {
					await streamRemoteLogsById(ws, serverId, containerId, tail);
				} else {
					await streamLocalLogsById(ws, containerId, tail);
				}
			} catch (error) {
				closeWithError(ws, error instanceof Error ? error.message : "Failed to stream logs");
			}
			return;
		}

		try {
			await assertWsDockerContainerAccess(session, serverId);
			await assertContainerNotProtected(containerId, serverId);
			if (serverId) {
				await streamRemoteLogsById(ws, serverId, containerId, tail);
			} else {
				await streamLocalLogsById(ws, containerId, tail);
			}
		} catch (error) {
			closeWithError(ws, error instanceof Error ? error.message : "Failed to stream logs");
		}
		return;
	}

	if (!appName || !isValidAppName(appName)) {
		closeWithError(ws, "Missing or invalid appName query parameter");
		return;
	}

	try {
		await assertWsContainerAccess(session, appName, serverId);
		if (serverId) {
			await streamRemoteLogs(ws, serverId, appName, tail);
		} else {
			await streamLocalLogs(ws, appName, tail);
		}
	} catch (error) {
		closeWithError(ws, error instanceof Error ? error.message : "Failed to stream logs");
	}
}

async function streamLocalLogs(ws: WebSocket, appName: string, tail: number): Promise<void> {
	const container = await resolveLocalContainer(appName);
	if (!container) {
		// Not an error state: the app simply has nothing deployed/running.
		// A distinct frame lets the client render an empty state instead of
		// retrying in a loop.
		sendJson(ws, { type: "empty", message: `No running container found for app "${appName}"` });
		ws.close(1000);
		return;
	}
	await pipeLocalLogs(ws, container, tail);
}

async function streamLocalLogsById(
	ws: WebSocket,
	containerId: string,
	tail: number,
): Promise<void> {
	const container = await resolveLocalContainerById(containerId);
	if (!container) {
		sendJson(ws, {
			type: "empty",
			message: `No running container found for id "${containerId}"`,
		});
		ws.close(1000);
		return;
	}
	await pipeLocalLogs(ws, container, tail);
}

async function pipeLocalLogs(
	ws: WebSocket,
	container: NonNullable<Awaited<ReturnType<typeof resolveLocalContainer>>>,
	tail: number,
): Promise<void> {
	// TTY containers emit a raw stream; others are multiplexed and must be demuxed.
	const info = await container.inspect();
	const isTty = info.Config?.Tty === true;

	const stream = (await container.logs({
		follow: true,
		stdout: true,
		stderr: true,
		tail,
		timestamps: false,
	})) as unknown as Readable;

	ws.on("close", () => {
		stream.destroy();
	});

	if (isTty) {
		stream.on("data", (chunk: Buffer) => safeSend(ws, chunk.toString()));
		stream.on("error", () => ws.close(1011));
		stream.on("end", () => ws.close(1000));
	} else {
		const out = new Writable({
			write(chunk, _encoding, callback) {
				safeSend(ws, chunk.toString());
				callback();
			},
		});
		getDocker().modem.demuxStream(stream, out, out);
		stream.on("error", () => ws.close(1011));
		stream.on("end", () => ws.close(1000));
	}
}

async function streamRemoteLogs(
	ws: WebSocket,
	serverId: string,
	appName: string,
	tail: number,
): Promise<void> {
	const conn = await connectToServer(serverId);
	ws.on("close", () => conn.end());

	const containerId = await resolveRemoteContainerId(conn, appName);
	if (!containerId) {
		conn.end();
		sendJson(ws, {
			type: "empty",
			message: `No running container found for app "${appName}" on the remote server`,
		});
		ws.close(1000);
		return;
	}

	pipeRemoteLogs(ws, conn, containerId, tail);
}

async function streamRemoteLogsById(
	ws: WebSocket,
	serverId: string,
	containerId: string,
	tail: number,
): Promise<void> {
	const conn = await connectToServer(serverId);
	ws.on("close", () => conn.end());
	pipeRemoteLogs(ws, conn, containerId, tail);
}

function pipeRemoteLogs(
	ws: WebSocket,
	conn: Awaited<ReturnType<typeof connectToServer>>,
	containerId: string,
	tail: number,
): void {
	const id = `'${containerId.replace(/'/g, `'\\''`)}'`;
	conn.exec(`docker logs --follow --tail ${tail} ${id} 2>&1`, (err, stream) => {
		if (err) {
			conn.end();
			closeWithError(ws, err.message);
			return;
		}
		stream
			.on("data", (data: Buffer) => safeSend(ws, data.toString()))
			.on("close", () => {
				conn.end();
				ws.close(1000);
			});
	});
}
