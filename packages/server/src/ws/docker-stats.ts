import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { type ContainerStatsFrame, mapDockerStats } from "../modules/docker/stats";
import { assertWsContainerAccess } from "./access";
import type { WsSession } from "./auth";
import {
	connectToServer,
	execOnConnection,
	resolveLocalContainer,
	resolveRemoteContainerId,
} from "./docker";
import { closeWithError, isValidAppName, sendJson, upgradeSearchParams } from "./utils";

const STATS_INTERVAL_MS = 1000;

/**
 * The frame shape and the dockerode mapping live in `modules/docker/stats.ts`
 * (the metrics cron and the monitoring router use them too); re-exported here
 * under their original names.
 */
export { type ContainerStatsFrame, mapDockerStats };

/**
 * /ws/stats?appName=<name>&serverId=<id?>
 *
 * Emits a JSON { cpu, memory, network } frame once per second. `cpu` is a
 * percentage (100 = one core), memory in bytes, network in cumulative bytes.
 */
export async function handleDockerStats(
	ws: WebSocket,
	req: IncomingMessage,
	session: WsSession,
): Promise<void> {
	const params = upgradeSearchParams(req);
	const appName = params.get("appName");
	const serverId = params.get("serverId");

	if (!appName || !isValidAppName(appName)) {
		closeWithError(ws, "Missing or invalid appName query parameter");
		return;
	}

	let interval: NodeJS.Timeout | null = null;
	let tickInFlight = false;

	try {
		await assertWsContainerAccess(session, appName, serverId);
		const sample = serverId
			? await createRemoteSampler(ws, serverId, appName)
			: await createLocalSampler(appName);

		interval = setInterval(() => {
			if (tickInFlight) return;
			tickInFlight = true;
			sample()
				.then((frame) => {
					if (frame) sendJson(ws, frame);
				})
				.catch(() => {
					// A single failed sample (container restarting, SSH blip) must not kill the feed.
				})
				.finally(() => {
					tickInFlight = false;
				});
		}, STATS_INTERVAL_MS);
	} catch (error) {
		closeWithError(ws, error instanceof Error ? error.message : "Failed to stream stats");
		return;
	}

	ws.on("close", () => {
		if (interval) clearInterval(interval);
	});
}

type Sampler = () => Promise<ContainerStatsFrame | null>;

async function createLocalSampler(appName: string): Promise<Sampler> {
	const container = await resolveLocalContainer(appName);
	if (!container) {
		throw new Error(`No running container found for app "${appName}"`);
	}
	return async () => {
		const stats = await container.stats({ stream: false });
		return mapDockerStats(stats);
	};
}

async function createRemoteSampler(
	ws: WebSocket,
	serverId: string,
	appName: string,
): Promise<Sampler> {
	const conn = await connectToServer(serverId);
	ws.on("close", () => conn.end());

	const containerId = await resolveRemoteContainerId(conn, appName);
	if (!containerId) {
		conn.end();
		throw new Error(`No running container found for app "${appName}" on the remote server`);
	}

	const format =
		'{"cpu":{{json .CPUPerc}},"mem":{{json .MemUsage}},"net":{{json .NetIO}},"block":{{json .BlockIO}},"pids":{{json .PIDs}}}';
	return async () => {
		const out = await execOnConnection(
			conn,
			`docker stats --no-stream --format '${format}' ${containerId}`,
		);
		const parsed = JSON.parse(out) as {
			cpu: string;
			mem: string;
			net: string;
			block: string;
			pids: string;
		};
		const [used = 0, total = 0] = parsed.mem.split("/").map((part) => parseByteSize(part.trim()));
		const [rx = 0, tx = 0] = parsed.net.split("/").map((part) => parseByteSize(part.trim()));
		const [blockRead = 0, blockWrite = 0] = parsed.block
			.split("/")
			.map((part) => parseByteSize(part.trim()));
		return {
			cpu: Number.parseFloat(parsed.cpu) || 0,
			memory: { used, total, percent: total > 0 ? (used / total) * 100 : 0 },
			network: { rx, tx },
			block: { read: blockRead, write: blockWrite },
			pids: Number.parseInt(parsed.pids, 10) || 0,
		};
	};
}

const BYTE_UNITS: Record<string, number> = {
	B: 1,
	kB: 1e3,
	MB: 1e6,
	GB: 1e9,
	TB: 1e12,
	KiB: 1024,
	MiB: 1024 ** 2,
	GiB: 1024 ** 3,
	TiB: 1024 ** 4,
};

/** Parse `docker stats` human sizes like "12.3MiB" or "1.04kB" into bytes. */
function parseByteSize(input: string): number {
	const match = /^([\d.]+)\s*([A-Za-z]+)$/.exec(input);
	if (!match) return 0;
	const value = Number.parseFloat(match[1] ?? "");
	const unit = BYTE_UNITS[match[2] ?? ""];
	return Number.isFinite(value) && unit ? value * unit : 0;
}
