import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type Docker from "dockerode";
import type { ClientChannel } from "ssh2";
import type { WebSocket } from "ws";
import { assertComposeContainerOwnership } from "../modules/compose/containers";
import { shellQuote } from "../modules/deployment/paths";
import { execAsyncRemote } from "../utils/exec";
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
	attachTerminalExec,
	terminalExecCommand,
	terminalSignalCommand,
	trackTerminalAttachment,
} from "./terminal-exec";
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
					await attachRemoteTerminal(ws, serverId, { containerId });
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
				await attachRemoteTerminal(ws, serverId, { containerId });
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
			await attachRemoteTerminal(ws, serverId, { appName });
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
	if (ws.readyState !== ws.OPEN) return;
	const container = await resolveLocalContainer(appName);
	if (ws.readyState !== ws.OPEN) return;
	if (!container) {
		closeWithError(ws, `No running container found for "${appName}" — deploy the service first`);
		return;
	}
	await pipeLocalExec(ws, container);
}

async function attachLocalTerminalById(ws: WebSocket, containerId: string): Promise<void> {
	if (ws.readyState !== ws.OPEN) return;
	const container = await resolveLocalContainerById(containerId);
	if (ws.readyState !== ws.OPEN) return;
	if (!container) {
		closeWithError(ws, `No running container found for id "${containerId}"`);
		return;
	}
	await pipeLocalExec(ws, container);
}

async function pipeLocalExec(ws: WebSocket, container: Docker.Container): Promise<void> {
	if (ws.readyState !== ws.OPEN) return;
	const nonce = randomUUID();
	const exec = await container.exec({
		Cmd: ["sh", "-c", terminalExecCommand(nonce, SHELL_FALLBACK_COMMAND)],
		AttachStdin: true,
		AttachStdout: true,
		AttachStderr: true,
		Tty: true,
		Env: ["TERM=xterm-256color"],
	});
	if (ws.readyState !== ws.OPEN) return;
	const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
	const lifecycle = attachTerminalExec({
		ws,
		stream,
		nonce,
		closeTransport: () => {
			stream.end();
			stream.destroy();
		},
		signal: async (identity, signal) => {
			const abortSignal = AbortSignal.timeout(2_000);
			const cleanup = await container.exec({
				Cmd: terminalSignalCommand(identity, signal),
				AttachStdin: false,
				AttachStdout: false,
				AttachStderr: false,
				Tty: false,
				abortSignal,
			});
			await cleanup.start({ Detach: true, abortSignal });
		},
	});
	ws.on("message", (raw: Buffer) => {
		if (!lifecycle.isReady()) return;
		const input = parseInput(raw);
		if (!input) return;
		if (input.type === "stdin") stream.write(input.data);
		else
			exec
				.resize({
					h: clampDimension(input.rows, DEFAULT_ROWS),
					w: clampDimension(input.cols, DEFAULT_COLS),
				})
				.catch(() => {});
	});
}

async function attachRemoteTerminal(
	ws: WebSocket,
	serverId: string,
	target: { appName: string } | { containerId: string },
): Promise<void> {
	if (ws.readyState !== ws.OPEN) return;
	let closed = false;
	let lease: Awaited<ReturnType<typeof acquireServerSsh>> | null = null;
	let channel: ClientChannel | null = null;
	const shutdown = () => {
		if (closed) return;
		closed = true;
		try {
			channel?.close();
		} catch {
			// The channel may already have closed with the shared connection.
		} finally {
			lease?.release();
		}
	};
	ws.once("close", shutdown);
	const acquired = await acquireServerSsh(serverId);
	if (closed || ws.readyState !== ws.OPEN) {
		acquired.release();
		return;
	}
	lease = acquired;
	lease.onConnectionLost((error) => {
		if (closed) return;
		shutdown();
		closeWithError(ws, `SSH connection lost: ${error.message}`);
	});
	let containerId: string | null;
	try {
		containerId =
			"containerId" in target
				? target.containerId
				: await resolveRemoteContainerId(lease.client, target.appName);
	} catch (error) {
		shutdown();
		throw error;
	}
	if (closed || ws.readyState !== ws.OPEN) {
		shutdown();
		return;
	}
	if (!containerId) {
		shutdown();
		closeWithError(
			ws,
			`No running container found for "${"appName" in target ? target.appName : target.containerId}" on the remote server — deploy first`,
		);
		return;
	}
	const nonce = randomUUID();
	const command = [
		"docker",
		"exec",
		"-it",
		containerId,
		"sh",
		"-c",
		terminalExecCommand(nonce, SHELL_FALLBACK_COMMAND),
	]
		.map(shellQuote)
		.join(" ");
	const client = lease.client;
	const attaching = new Promise<void>((resolve, reject) => {
		client.exec(
			command,
			{ pty: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS, term: "xterm-256color" } },
			(err, stream) => {
				try {
					if (err) {
						shutdown();
						closeWithError(ws, err.message);
						return;
					}
					// The exec identity reader now owns cancellation, including a close
					// before its first bytes arrive. Do not detach that reader early.
					ws.off("close", shutdown);
					channel = stream;
					const lifecycle = attachTerminalExec({
						ws,
						stream,
						nonce,
						closeTransport: () => {
							if (closed) stream.close();
							else shutdown();
						},
						signal: async (identity, signal) => {
							const cleanup = [
								"docker",
								"exec",
								containerId,
								...terminalSignalCommand(identity, signal),
							]
								.map(shellQuote)
								.join(" ");
							await execAsyncRemote(serverId, cleanup, { timeoutMs: 2_000 });
						},
					});
					stream.stderr.on("data", (data: Buffer) => safeSend(ws, data));
					ws.on("message", (raw: Buffer) => {
						if (!lifecycle.isReady()) return;
						const input = parseInput(raw);
						if (!input) return;
						if (input.type === "stdin") stream.write(input.data);
						else
							stream.setWindow(
								clampDimension(input.rows, DEFAULT_ROWS),
								clampDimension(input.cols, DEFAULT_COLS),
								0,
								0,
							);
					});
				} catch (error) {
					reject(error);
				} finally {
					resolve();
				}
			},
		);
	});
	void trackTerminalAttachment(attaching).catch((error: unknown) => {
		shutdown();
		closeWithError(ws, error instanceof Error ? error.message : "Failed to attach terminal");
	});
}

function clampDimension(value: number | undefined, fallback: number): number {
	if (!value || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.floor(value), 1), 1000);
}
