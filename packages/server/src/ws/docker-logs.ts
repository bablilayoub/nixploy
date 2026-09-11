import type { IncomingMessage } from "node:http";
import { type Readable, Writable } from "node:stream";
import type { WebSocket } from "ws";
import { assertComposeContainerOwnership } from "../modules/compose/containers";
import { assertWsContainerAccess, assertWsDockerContainerAccess } from "./access";
import type { WsSession } from "./auth";
import {
	acquireServerSsh,
	assertContainerNotProtected,
	getDocker,
	resolveLocalContainer,
	resolveLocalContainerById,
	resolveRemoteContainerId,
	withServerSsh,
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
			await assertWsDockerContainerAccess(session, containerId, serverId);
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

/* -------------------------------------------------------------------------- */
/*  Shared follow streams                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One `docker logs --follow` per (container, tail), fanned out to every
 * viewer (audit #20). Each client used to open its own follower — and, for a
 * managed server, its own SSH session — so three people watching one
 * container meant three SSH channels and three copies of the same bytes over
 * the wire from the host.
 *
 * A late joiner replays what the shared stream has captured so far (the
 * initial `--tail N` backfill plus everything since), capped at
 * {@link MAX_REPLAY_BYTES}; the stream stops as soon as its last viewer
 * disconnects. The registry is keyed by tail size too, so a client asking for
 * a different backfill still gets an exact answer instead of someone else's
 * window.
 */
const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

/** Starts the underlying follow; returns the function that stops it. */
type StreamStarter = (handlers: {
	emit: (chunk: string) => void;
	fail: () => void;
	end: () => void;
}) => Promise<() => void>;

interface SharedStream {
	subscribers: Set<WebSocket>;
	/** Everything seen so far, oldest first, bounded by MAX_REPLAY_BYTES. */
	replay: string[];
	replayBytes: number;
	starting: Promise<void>;
	stop: (() => void) | null;
	ended: boolean;
}

const sharedStreams = new Map<string, SharedStream>();

/** Number of live shared streams — exported for tests. */
export function sharedLogStreamCount(): number {
	return sharedStreams.size;
}

function remember(entry: SharedStream, chunk: string): void {
	entry.replay.push(chunk);
	entry.replayBytes += chunk.length;
	while (entry.replayBytes > MAX_REPLAY_BYTES && entry.replay.length > 1) {
		const dropped = entry.replay.shift();
		entry.replayBytes -= dropped?.length ?? 0;
	}
}

function teardown(key: string): void {
	const entry = sharedStreams.get(key);
	if (!entry) return;
	sharedStreams.delete(key);
	try {
		entry.stop?.();
	} catch {
		// stream already gone
	}
}

function release(key: string, ws: WebSocket): void {
	const entry = sharedStreams.get(key);
	if (!entry) return;
	entry.subscribers.delete(ws);
	// Last viewer left: stop following (and drop the SSH session with it).
	if (entry.subscribers.size === 0) teardown(key);
}

async function subscribeShared(ws: WebSocket, key: string, start: StreamStarter): Promise<void> {
	let entry = sharedStreams.get(key);
	if (!entry) {
		const created: SharedStream = {
			subscribers: new Set(),
			replay: [],
			replayBytes: 0,
			starting: Promise.resolve(),
			stop: null,
			ended: false,
		};
		sharedStreams.set(key, created);
		created.starting = start({
			emit: (chunk) => {
				remember(created, chunk);
				for (const client of created.subscribers) safeSend(client, chunk);
			},
			fail: () => {
				for (const client of created.subscribers) client.close(1011);
				teardown(key);
			},
			end: () => {
				created.ended = true;
				for (const client of created.subscribers) client.close(1000);
				teardown(key);
			},
		}).then((stop) => {
			// The last viewer may have left while the stream was still opening.
			if (sharedStreams.get(key) === created) created.stop = stop;
			else stop();
		});
		entry = created;
	}

	ws.on("close", () => release(key, ws));

	try {
		await entry.starting;
	} catch (error) {
		teardown(key);
		throw error;
	}

	// Replay, then subscribe — in one synchronous step, so a chunk arriving
	// right now is either in the replay or in the live fan-out, never both.
	for (const chunk of entry.replay) safeSend(ws, chunk);
	entry.subscribers.add(ws);
	if (entry.ended) ws.close(1000);
}

/* -------------------------------------------------------------------------- */
/*  Local (dockerode)                                                         */
/* -------------------------------------------------------------------------- */

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
	await subscribeShared(ws, `local:${container.id}:${tail}`, async ({ emit, fail, end }) => {
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

		if (isTty) {
			stream.on("data", (chunk: Buffer) => emit(chunk.toString()));
		} else {
			const out = new Writable({
				write(chunk, _encoding, callback) {
					emit(chunk.toString());
					callback();
				},
			});
			getDocker().modem.demuxStream(stream, out, out);
		}
		stream.on("error", () => fail());
		stream.on("end", () => end());
		return () => stream.destroy();
	});
}

/* -------------------------------------------------------------------------- */
/*  Remote (SSH)                                                              */
/* -------------------------------------------------------------------------- */

async function streamRemoteLogs(
	ws: WebSocket,
	serverId: string,
	appName: string,
	tail: number,
): Promise<void> {
	// One pooled channel just to resolve the id; the follow takes its own.
	const containerId = await withServerSsh(serverId, (client) =>
		resolveRemoteContainerId(client, appName),
	);
	if (!containerId) {
		sendJson(ws, {
			type: "empty",
			message: `No running container found for app "${appName}" on the remote server`,
		});
		ws.close(1000);
		return;
	}
	await pipeRemoteLogs(ws, serverId, containerId, tail);
}

async function streamRemoteLogsById(
	ws: WebSocket,
	serverId: string,
	containerId: string,
	tail: number,
): Promise<void> {
	await pipeRemoteLogs(ws, serverId, containerId, tail);
}

async function pipeRemoteLogs(
	ws: WebSocket,
	serverId: string,
	containerId: string,
	tail: number,
): Promise<void> {
	const id = `'${containerId.replace(/'/g, `'\\''`)}'`;
	await subscribeShared(ws, `${serverId}:${containerId}:${tail}`, ({ emit, fail, end }) =>
		// One channel on the server's pooled connection per container, not per
		// viewer (audit #20) and not a whole SSH connection per follow (#7).
		acquireServerSsh(serverId).then(
			(lease) =>
				new Promise<() => void>((resolve, reject) => {
					lease.onConnectionLost(() => fail());
					lease.client.exec(`docker logs --follow --tail ${tail} ${id} 2>&1`, (err, stream) => {
						if (err) {
							lease.discard(err);
							reject(err);
							return;
						}
						// The channel holds the pool slot for as long as it follows.
						stream.once("close", () => lease.release());
						stream
							.on("data", (data: Buffer) => emit(data.toString()))
							.on("error", () => {
								lease.release();
								fail();
							})
							.on("close", () => end());
						resolve(() => {
							try {
								stream.close();
							} catch {
								// channel already gone
							}
							lease.release();
						});
					});
				}),
		),
	);
}
