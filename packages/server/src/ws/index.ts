import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { trustedOriginsWithDashboardDomain } from "../lib/auth";
import {
	type ProjectFilter,
	resolveProjectFilter,
	runWithProjectFilter,
} from "../modules/projects/project-scope";
import { getSessionFromUpgrade, type WsSession } from "./auth";
import { handleDeploymentLogs } from "./deployment-logs";
import { handleDockerLogs } from "./docker-logs";
import { handleDockerStats } from "./docker-stats";
import { handleDockerTerminal } from "./docker-terminal";
import { handlePlatformEvents } from "./events";
import { handleServerTerminal } from "./server-terminal";
import { drainTerminalExecs, trackTerminalAttachment } from "./terminal-exec";

export type WsConnectionHandler = (
	ws: WebSocket,
	req: IncomingMessage,
	session: WsSession,
) => void | Promise<void>;

const HEARTBEAT_INTERVAL_MS = 30_000;
/**
 * Largest inbound frame accepted. Browsers only send small control frames
 * (terminal keystrokes, resize) on these endpoints; anything bigger is a
 * client trying to grow server memory (security audit 2.7).
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** How long a graceful close waits for clients to acknowledge before terminating. */
const CLOSE_GRACE_MS = 1_000;

interface TrackedSocket extends WebSocket {
	isAlive?: boolean;
}

const routes: Record<string, WsConnectionHandler> = {
	"/ws/deployment": handleDeploymentLogs,
	"/ws/events": handlePlatformEvents,
	"/ws/logs": handleDockerLogs,
	"/ws/stats": handleDockerStats,
	"/ws/terminal": handleDockerTerminal,
	"/ws/server-terminal": handleServerTerminal,
};

const globalForWs = globalThis as typeof globalThis & {
	__nixployWebSockets?: {
		heartbeat: NodeJS.Timeout | null;
		servers: Set<WebSocketServer>;
		closing: boolean;
	};
};
const state = globalForWs.__nixployWebSockets ?? {
	heartbeat: null,
	servers: new Set(),
	closing: false,
};
globalForWs.__nixployWebSockets = state;
const servers = state.servers;

/**
 * Attach all Nixploy websocket endpoints to the shared HTTP server:
 *   /ws/deployment?deploymentId=  — replay + live-follow of deploy logs
 *   /ws/events                    — org-scoped deployment/queue/status pushes
 *   /ws/logs?appName=&serverId=   — `docker logs -f` of the app's container
 *   /ws/stats?appName=&serverId=  — 1s cpu/memory/network frames
 *   /ws/terminal?appName=&serverId= — interactive shell in the container
 *   /ws/server-terminal?serverId=  — SSH host shell on a managed server
 *
 * Every upgrade is authenticated against the better-auth session cookie;
 * unauthenticated upgrades get a 401 and a destroyed socket. Browser
 * upgrades must also come from the panel's own origin (or a configured
 * trusted origin) — a 403 otherwise — so a third-party page cannot ride the
 * cookie into a terminal even if cookie SameSite defaults change.
 */
export function setupWebSocketServer(httpServer: HttpServer): void {
	state.closing = false;
	httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		void handleUpgrade(httpServer, req, socket, head);
	});

	if (state.heartbeat) clearInterval(state.heartbeat);
	state.heartbeat = setInterval(() => {
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
	state.heartbeat.unref();
}

async function handleUpgrade(
	httpServer: HttpServer,
	req: IncomingMessage,
	socket: Duplex,
	head: Buffer,
): Promise<void> {
	const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
	const handler = routes[pathname];
	if (!handler) {
		// Not a Nixploy endpoint — leave the socket untouched so other
		// upgrade listeners (e.g. Next.js dev HMR at /_next/webpack-hmr)
		// can handle it. When we are the only listener nobody will, so
		// destroy the socket instead of leaking the TCP connection.
		if (httpServer.listenerCount("upgrade") === 1) {
			socket.destroy();
		}
		return;
	}
	if (state.closing) {
		socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
		socket.destroy();
		return;
	}

	if (!(await isAllowedUpgradeOrigin(req))) {
		socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
		socket.destroy();
		return;
	}

	const session = await getSessionFromUpgrade(req);
	if (!session) {
		socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
		socket.destroy();
		return;
	}

	// Upgrades bypass protectedProcedure, so install the same caller scope
	// before a handler reaches a service. Resolve it afresh on every connection.
	let projectFilter: ProjectFilter;
	try {
		projectFilter = await resolveProjectFilter(session.user.id);
	} catch {
		// A failed visibility lookup must never open an unrestricted shell.
		socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
		socket.destroy();
		return;
	}
	if (socket.destroyed) return;
	if (state.closing) {
		socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
		socket.destroy();
		return;
	}

	let wss = [...servers].find((s) => s.options.path === pathname);
	if (!wss) {
		wss = new WebSocketServer({ noServer: true, path: pathname, maxPayload: MAX_PAYLOAD_BYTES });
		servers.add(wss);
	}

	wss.handleUpgrade(req, socket, head, (ws: TrackedSocket) => {
		ws.isAlive = true;
		ws.on("pong", () => {
			ws.isAlive = true;
		});
		// Protocol/receiver failures belong to this connection. In particular,
		// ws has already begun a 1009 close when its payload limit is exceeded.
		ws.on("error", () => {
			if (ws.readyState === ws.OPEN) ws.close(1011);
		});
		wss.emit("connection", ws, req);
		runWithProjectFilter(projectFilter, () => {
			const attachment = Promise.resolve()
				.then(() => handler(ws, req, session))
				.catch(() => {
					ws.close(1011);
				});
			if (pathname === "/ws/terminal" || pathname === "/ws/server-terminal") {
				trackTerminalAttachment(attachment);
			}
		});
	});
}

/** `scheme://host[:port]` of a URL, lower-cased, or null when unparsable. */
function originOf(value: string): string | null {
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host}`.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Browsers always send `Origin` on WebSocket upgrades; non-browser clients
 * (CLI, curl) usually do not and are allowed through — they cannot carry a
 * victim's cookie. Same-origin requests (Origin host == Host) and the
 * better-auth trusted origins (BETTER_AUTH_URL + dashboard domain) pass.
 */
export async function isAllowedUpgradeOrigin(req: IncomingMessage): Promise<boolean> {
	const raw = req.headers.origin;
	if (!raw) return true;
	const origin = originOf(raw);
	if (!origin) return false;
	const host = req.headers.host?.trim().toLowerCase();
	if (host && origin.endsWith(`//${host}`)) return true;
	const trusted = await trustedOriginsWithDashboardDomain();
	return trusted.some((entry) => originOf(entry) === origin);
}

/**
 * Graceful shutdown: stop heartbeats, tell every client we are going away
 * (1001 — the log viewer reconnects with backoff once the panel is back),
 * then terminate whatever has not acknowledged within {@link CLOSE_GRACE_MS}.
 * Resolves with the number of connections that were open.
 */
export async function closeWebSocketServer(): Promise<number> {
	state.closing = true;
	if (state.heartbeat) {
		clearInterval(state.heartbeat);
		state.heartbeat = null;
	}
	const open = [...servers].flatMap((wss) => [...wss.clients]);
	for (const ws of open) {
		try {
			ws.close(1001, "Server restarting");
		} catch {
			ws.terminate();
		}
	}
	const terminalCleanup = drainTerminalExecs();
	if (open.length > 0) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, CLOSE_GRACE_MS);
		});
	}
	for (const wss of servers) {
		for (const ws of wss.clients) {
			ws.terminate();
		}
		wss.close();
	}
	servers.clear();
	await terminalCleanup;
	return open.length;
}

/** Number of live websocket connections across all endpoints (health/metrics). */
export function getWebSocketConnectionCount(): number {
	let count = 0;
	for (const wss of servers) {
		count += wss.clients.size;
	}
	return count;
}
