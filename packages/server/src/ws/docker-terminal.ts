import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { WsSession } from "./auth";
import {
	connectToServer,
	resolveLocalContainer,
	resolveRemoteContainerId,
	SHELL_FALLBACK_COMMAND,
} from "./docker";
import { closeWithError, isValidAppName, safeSend, upgradeSearchParams } from "./utils";

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
 *
 * Interactive shell inside the app's container (bash with sh fallback).
 * Client → server frames are JSON: { type: "stdin", data } and
 * { type: "resize", cols, rows }. Server → client frames are raw binary
 * terminal output.
 */
export async function handleDockerTerminal(
	ws: WebSocket,
	req: IncomingMessage,
	_session: WsSession,
): Promise<void> {
	const params = upgradeSearchParams(req);
	const appName = params.get("appName");
	const serverId = params.get("serverId");

	if (!appName || !isValidAppName(appName)) {
		closeWithError(ws, "Missing or invalid appName query parameter");
		return;
	}

	try {
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
		closeWithError(ws, `No running container found for app "${appName}"`);
		return;
	}

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
	const conn = await connectToServer(serverId);
	ws.on("close", () => conn.end());

	const containerId = await resolveRemoteContainerId(conn, appName);
	if (!containerId) {
		conn.end();
		closeWithError(ws, `No running container found for app "${appName}" on the remote server`);
		return;
	}

	conn.exec(
		`docker exec -it ${containerId} sh -c '${SHELL_FALLBACK_COMMAND}'`,
		{ pty: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS, term: "xterm-256color" } },
		(err, stream) => {
			if (err) {
				conn.end();
				closeWithError(ws, err.message);
				return;
			}
			stream
				.on("data", (data: Buffer) => safeSend(ws, data))
				.on("close", () => {
					conn.end();
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
