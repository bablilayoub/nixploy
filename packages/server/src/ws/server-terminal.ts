import type { IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import type { WebSocket } from "ws";
import { db } from "../db";
import { servers } from "../db/schema";
import { recordAudit } from "../modules/audit";
import { assertInstanceAdmin } from "../modules/auth/instance-admin";
import { findServerById } from "../modules/cluster/servers";
import { hasCapability } from "../modules/projects";
import { verifyRemoteHostKey } from "../utils/exec";
import { clientIpFromHeaders, userAgentFromHeaders } from "../utils/rate-limit";
import { resolveWsOrganizationId } from "./access";
import type { WsSession } from "./auth";
import { closeWithError, requestHeaders, safeSend, upgradeSearchParams } from "./utils";

/**
 * `/ws/server-terminal?serverId=<id>` — an interactive **host** shell on a
 * managed remote server over SSH (product audit, Platform row "No server SSH
 * web terminal").
 *
 * Deliberately remote-only. There is no local-host terminal: the panel runs
 * as root inside its own container with the Docker socket mounted, so a shell
 * there is a shell on the whole instance, every tenant's data included, one
 * XSS away from the browser. `docker exec` into a *container* stays the
 * supported local escape hatch (`/ws/terminal`).
 *
 * Authorization is the strictest gate in the codebase and needs both halves:
 * `servers.manage` in the caller's organization **and** the instance-admin
 * role. A managed server joins the primary Swarm and runs other tenants'
 * unpinned tasks as root, so a host shell on it is a platform-wide
 * capability, not an org-level one — the same reasoning `server.setup` and
 * the Swarm tab already use (`docs/docker.md`).
 *
 * Frames match `/ws/terminal` exactly so the panel reuses the xterm client:
 * client → server `{"type":"stdin","data":"…"}` / `{"type":"resize","cols":…,
 * "rows":…}`, server → client raw terminal bytes.
 */

interface TerminalInput {
	type: "stdin" | "resize";
	data?: string;
	cols?: number;
	rows?: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const SSH_READY_TIMEOUT_MS = 30_000;

/**
 * A forgotten browser tab must not hold a root shell open forever. Any
 * keystroke or resize resets the clock; output alone does not (a `tail -f`
 * left running is exactly the case this closes).
 */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Parse a client control frame; unknown shapes are dropped, never executed. */
export function parseTerminalInput(raw: Buffer | string): TerminalInput | null {
	try {
		const parsed = JSON.parse(raw.toString()) as TerminalInput;
		if (parsed.type === "stdin" && typeof parsed.data === "string") return parsed;
		if (
			parsed.type === "resize" &&
			typeof parsed.cols === "number" &&
			typeof parsed.rows === "number"
		) {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

/** Clamp a terminal dimension the client sent into something ssh2 accepts. */
export function clampDimension(value: number | undefined, fallback: number): number {
	if (!value || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.floor(value), 1), 1000);
}

/**
 * Gate for a host shell: org membership (with the 2FA gate),
 * `servers.manage`, instance admin, and the server row must belong to the
 * caller's organization. Returns the resolved org id and the server row.
 */
export async function assertServerTerminalAccess(
	session: WsSession,
	serverId: string,
): Promise<{ organizationId: string; serverName: string }> {
	const organizationId = await resolveWsOrganizationId(session);
	const allowed = await hasCapability(session.user.id, organizationId, "servers.manage");
	if (!allowed) {
		throw new Error('This action requires the "servers.manage" capability');
	}
	// A host shell on a Swarm member is platform-wide power, not org-level.
	await assertInstanceAdmin(session);
	const server = await findServerById(serverId, organizationId);
	if (!server) {
		throw new Error(`Server not found: ${serverId}`);
	}
	return { organizationId, serverName: server.name };
}

/** Server row + decrypted SSH key, or a readable error. */
async function loadServerConnection(serverId: string) {
	const server = await db.query.servers.findFirst({
		where: eq(servers.serverId, serverId),
		with: { sshKey: true },
	});
	if (!server) {
		throw new Error(`Server not found: ${serverId}`);
	}
	if (!server.sshKey) {
		throw new Error(`Server ${server.name} has no SSH key attached`);
	}
	return server;
}

export async function handleServerTerminal(
	ws: WebSocket,
	req: IncomingMessage,
	session: WsSession,
): Promise<void> {
	const serverId = upgradeSearchParams(req).get("serverId");
	if (!serverId) {
		closeWithError(
			ws,
			"Missing serverId query parameter — host terminals are only available on managed remote servers",
		);
		return;
	}

	let organizationId: string;
	let serverName: string;
	try {
		({ organizationId, serverName } = await assertServerTerminalAccess(session, serverId));
	} catch (error) {
		closeWithError(ws, error instanceof Error ? error.message : "Access denied");
		return;
	}

	// Audited before the connection is attempted: a refused SSH handshake on
	// somebody else's box is exactly the attempt an operator wants to see.
	const headers = requestHeaders(req);
	void recordAudit({
		organizationId,
		actorId: session.user.id,
		actorEmail: session.user.email,
		action: "server.terminal.open",
		targetType: "server",
		targetId: serverId,
		targetName: serverName,
		ip: clientIpFromHeaders(headers),
		userAgent: userAgentFromHeaders(headers),
	});

	try {
		await attachServerShell(ws, serverId);
	} catch (error) {
		closeWithError(ws, error instanceof Error ? error.message : "Failed to open the server shell");
	}
}

/**
 * Open a dedicated SSH connection and a PTY on it.
 *
 * Deliberately *not* the pooled client (`utils/ssh-pool.ts`): a shell holds
 * its channel for as long as the operator types, and the pool's channel
 * budget exists to keep short commands (`docker ps`, the metrics batch)
 * flowing. One connection per open terminal, ended with the socket.
 */
async function attachServerShell(ws: WebSocket, serverId: string): Promise<void> {
	const server = await loadServerConnection(serverId);
	const privateKey = server.sshKey?.privateKey;
	if (!privateKey) {
		throw new Error(`Server ${server.name} has no SSH key attached`);
	}

	const conn = new Client();
	let closed = false;
	const shutdown = () => {
		if (closed) return;
		closed = true;
		if (idleTimer) clearTimeout(idleTimer);
		try {
			conn.end();
		} catch {
			// already gone
		}
	};

	let idleTimer: NodeJS.Timeout | null = null;
	const touch = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			safeSend(ws, "\r\n\x1b[33m--- Session closed after 30 minutes of inactivity ---\x1b[0m\r\n");
			shutdown();
			ws.close(1000, "Idle timeout");
		}, IDLE_TIMEOUT_MS);
		idleTimer.unref?.();
	};
	touch();

	ws.on("close", shutdown);

	conn
		.on("ready", () => {
			conn.shell(
				{ term: "xterm-256color", cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
				(err, stream) => {
					if (err) {
						shutdown();
						closeWithError(ws, err.message);
						return;
					}
					stream
						.on("data", (data: Buffer) => safeSend(ws, data))
						.on("close", () => {
							shutdown();
							ws.close(1000);
						});
					stream.stderr.on("data", (data: Buffer) => safeSend(ws, data));

					ws.on("message", (raw: Buffer) => {
						const input = parseTerminalInput(raw);
						if (!input) return;
						touch();
						if (input.type === "stdin") {
							stream.write(input.data);
						} else {
							stream.setWindow(
								clampDimension(input.rows, DEFAULT_ROWS),
								clampDimension(input.cols, DEFAULT_COLS),
								0,
								0,
							);
						}
					});
				},
			);
		})
		.on("error", (err: Error) => {
			shutdown();
			closeWithError(ws, `SSH connection failed: ${err.message}`);
		})
		.connect({
			host: server.ipAddress,
			port: server.port,
			username: server.username,
			privateKey,
			readyTimeout: SSH_READY_TIMEOUT_MS,
			// Same trust-on-first-use pin every other SSH path uses; a swapped
			// host key closes the socket instead of typing into a stranger.
			hostVerifier: (key: Buffer) => verifyRemoteHostKey(serverId, key),
		});
}
