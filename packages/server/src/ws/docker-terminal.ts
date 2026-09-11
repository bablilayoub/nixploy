import type { IncomingMessage } from "node:http";
import type Docker from "dockerode";
import type { WebSocket } from "ws";
import { assertComposeContainerOwnership } from "../modules/compose/containers";
import { assertWsDockerContainerAccess, assertWsTerminalAccess } from "./access";
import type { WsSession } from "./auth";
import {
	acquireServerSsh,
	assertContainerNotProtected,
	resolveLocalContainer,
	resolveLocalContainerById,
	resolveRemoteContainerId,
	SHELL_FALLBACK_COMMAND,
} from "./docker";
import {
	closeWithError,
	isValidAppName,
	isValidContainerId,
	safeSend,
	upgradeSearchParams,
} from "./utils";

interface TerminalInput {
	type: "stdin" | "resize";
	data?: string;
	cols?: number;
	rows?: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * /ws/terminal?appName=<name>&serverId=<id?>
 * /ws/terminal?appName=<name>&containerId=<id>&serverId=<id?>  (compose service pick)
 * /ws/terminal?containerId=<id>&serverId=<id?>                 (Docker control center)
 *
 * Interactive shell inside a container (bash with sh fallback).
 * Client → server frames are JSON: { type: "stdin", data } and
 * { type: "resize", cols, rows }. Server → client frames are raw binary
 * terminal output.
 */
export async function handleDockerTerminal(
	ws: WebSocket,
	req: IncomingMessage,
	session: WsSession,
): Promise<void> {
	const params = upgradeSearchParams(req);
	const appName = params.get("appName");
	const containerId = params.get("containerId");
	const serverId = params.get("serverId");

	if (containerId) {
		if (!isValidContainerId(containerId)) {
			closeWithError(ws, "Missing or invalid containerId query parameter");
			return;
		}

		// Service-scoped: caller owns the Nixploy app and the container is part of it.
		if (appName) {
			if (!isValidAppName(appName)) {
				closeWithError(ws, "Missing or invalid appName query parameter");
				return;
			}
			try {
				await assertWsTerminalAccess(session, appName, serverId);
				await assertComposeContainerOwnership(appName, containerId, serverId);
				if (serverId) {
					await attachRemoteTerminalById(ws, serverId, containerId);
				} else {
					await attachLocalTerminalById(ws, containerId);
				}
			} catch (error) {
				closeWithError(ws, error instanceof Error ? error.message : "Failed to open terminal");
			}
			return;
		}

		try {
			await assertWsDockerContainerAccess(session, containerId, serverId);
			await assertContainerNotProtected(containerId, serverId);
			if (serverId) {
				await attachRemoteTerminalById(ws, serverId, containerId);
			} else {
				await attachLocalTerminalById(ws, containerId);
			}
		} catch (error) {
			closeWithError(ws, error instanceof Error ? error.message : "Failed to open terminal");
		}
		return;
	}

	if (!appName || !isValidAppName(appName)) {
		closeWithError(ws, "Missing or invalid appName query parameter");
		return;
	}

	try {
		await assertWsTerminalAccess(session, appName, serverId);
		if (serverId) {
			await attachRemoteTerminal(ws, serverId, appName);
		} else {
			await attachLocalTerminal(ws, appName);
		}
	} catch (error) {
		closeWithError(ws, error instanceof Error ? error.message : "Failed to open terminal");
	}
}

function parseInput(raw: Buffer | string): TerminalInput | null {
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

async function attachLocalTerminal(ws: WebSocket, appName: string): Promise<void> {
	const container = await resolveLocalContainer(appName);
	if (!container) {
		closeWithError(ws, `No running container found for "${appName}" — deploy the service first`);
		return;
	}
	await pipeLocalExec(ws, container);
}

async function attachLocalTerminalById(ws: WebSocket, containerId: string): Promise<void> {
	const container = await resolveLocalContainerById(containerId);
	if (!container) {
		closeWithError(ws, `No running container found for id "${containerId}"`);
		return;
	}
	await pipeLocalExec(ws, container);
}

async function pipeLocalExec(ws: WebSocket, container: Docker.Container): Promise<void> {
	const exec = await container.exec({
		Cmd: ["sh", "-c", SHELL_FALLBACK_COMMAND],
		AttachStdin: true,
		AttachStdout: true,
		AttachStderr: true,
		Tty: true,
		Env: ["TERM=xterm-256color", `COLUMNS=${DEFAULT_COLS}`, `LINES=${DEFAULT_ROWS}`],
	});
	// TTY is on, so the hijacked stream carries raw terminal output (no multiplex headers).
	const stream = await exec.start({ hijack: true, stdin: true, Tty: true });

	stream.on("data", (chunk: Buffer) => safeSend(ws, chunk));
	stream.on("error", () => ws.close(1011));
	stream.on("end", () => ws.close(1000));

	ws.on("message", (raw: Buffer) => {
		const input = parseInput(raw);
		if (!input) return;
		if (input.type === "stdin") {
			stream.write(input.data);
		} else {
			exec
				.resize({
					h: clampDimension(input.rows, DEFAULT_ROWS),
					w: clampDimension(input.cols, DEFAULT_COLS),
				})
				.catch(() => {});
		}
	});
	ws.on("close", () => {
		stream.end();
		stream.destroy();
	});
}

async function attachRemoteTerminal(
	ws: WebSocket,
	serverId: string,
	appName: string,
): Promise<void> {
	const lease = await acquireServerSsh(serverId);
	ws.on("close", () => lease.release());

	const containerId = await resolveRemoteContainerId(lease.client, appName);
	if (!containerId) {
		lease.release();
		closeWithError(
			ws,
			`No running container found for "${appName}" on the remote server — deploy first`,
		);
		return;
	}

	pipeRemoteExec(ws, lease, containerId);
}

async function attachRemoteTerminalById(
	ws: WebSocket,
	serverId: string,
	containerId: string,
): Promise<void> {
	const lease = await acquireServerSsh(serverId);
	ws.on("close", () => lease.release());
	pipeRemoteExec(ws, lease, containerId);
}

function pipeRemoteExec(
	ws: WebSocket,
	lease: Awaited<ReturnType<typeof acquireServerSsh>>,
	containerId: string,
): void {
	const id = `'${containerId.replace(/'/g, `'\\''`)}'`;
	lease.client.exec(
		`docker exec -it ${id} sh -c '${SHELL_FALLBACK_COMMAND}'`,
		{ pty: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS, term: "xterm-256color" } },
		(err, stream) => {
			if (err) {
				lease.release();
				closeWithError(ws, err.message);
				return;
			}
			// Free the PTY channel (and the pool slot) when the browser goes away.
			ws.on("close", () => stream.close());
			stream
				.on("data", (data: Buffer) => safeSend(ws, data))
				.on("close", () => {
					lease.release();
					ws.close(1000);
				});
			stream.stderr.on("data", (data: Buffer) => safeSend(ws, data));

			ws.on("message", (raw: Buffer) => {
				const input = parseInput(raw);
				if (!input) return;
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
}

function clampDimension(value: number | undefined, fallback: number): number {
	if (!value || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.floor(value), 1), 1000);
}
