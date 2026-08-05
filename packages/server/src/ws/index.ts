import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { getSessionFromUpgrade, type WsSession } from "./auth";
import { handleDeploymentLogs } from "./deployment-logs";
import { handleDockerLogs } from "./docker-logs";
import { handleDockerStats } from "./docker-stats";
import { handleDockerTerminal } from "./docker-terminal";

export type WsConnectionHandler = (
	ws: WebSocket,
	req: IncomingMessage,
	session: WsSession,
) => void | Promise<void>;

const HEARTBEAT_INTERVAL_MS = 30_000;

interface TrackedSocket extends WebSocket {
	isAlive?: boolean;
}

const routes: Record<string, WsConnectionHandler> = {
	"/ws/deployment": handleDeploymentLogs,
	"/ws/logs": handleDockerLogs,
	"/ws/stats": handleDockerStats,
	"/ws/terminal": handleDockerTerminal,
};

let heartbeat: NodeJS.Timeout | null = null;
const servers = new Set<WebSocketServer>();

/**
 * Attach all Nixploy websocket endpoints to the shared HTTP server:
 *   /ws/deployment?deploymentId=  — replay + live-follow of deploy logs
 *   /ws/logs?appName=&serverId=   — `docker logs -f` of the app's container
 *   /ws/stats?appName=&serverId=  — 1s cpu/memory/network frames
 *   /ws/terminal?appName=&serverId= — interactive shell in the container
 *
 * Every upgrade is authenticated against the better-auth session cookie;
 * unauthenticated upgrades get a 401 and a destroyed socket.
 */
export function setupWebSocketServer(httpServer: HttpServer): void {
	httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		void handleUpgrade(req, socket, head);
	});

	heartbeat = setInterval(() => {
		for (const wss of servers) {
			for (const ws of wss.clients as Set<TrackedSocket>) {
				if (ws.isAlive === false) {
					ws.terminate();
					continue;
				}
				ws.isAlive = false;
				ws.ping();
			}
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref();
}

async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
	const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
	const handler = routes[pathname];
	if (!handler) {
		// Not a Nixploy endpoint — leave the socket untouched so other
		// upgrade listeners (e.g. Next.js dev HMR at /_next/webpack-hmr)
		// can handle it.
		return;
	}

	const session = await getSessionFromUpgrade(req);
	if (!session) {
		socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
		socket.destroy();
		return;
	}

	let wss = [...servers].find((s) => s.options.path === pathname);
	if (!wss) {
		wss = new WebSocketServer({ noServer: true, path: pathname });
		servers.add(wss);
	}

	wss.handleUpgrade(req, socket, head, (ws: TrackedSocket) => {
		ws.isAlive = true;
		ws.on("pong", () => {
			ws.isAlive = true;
		});
		wss.emit("connection", ws, req);
		Promise.resolve(handler(ws, req, session)).catch(() => {
			ws.close(1011);
		});
	});
}

/** Graceful shutdown: stop heartbeats and close every endpoint + connection. */
export function closeWebSocketServer(): void {
	if (heartbeat) {
		clearInterval(heartbeat);
		heartbeat = null;
	}
	for (const wss of servers) {
		for (const ws of wss.clients) {
			ws.terminate();
		}
		wss.close();
	}
	servers.clear();
}

/** Number of live websocket connections across all endpoints (health/metrics). */
export function getWebSocketConnectionCount(): number {
	let count = 0;
	for (const wss of servers) {
		count += wss.clients.size;
	}
	return count;
}
