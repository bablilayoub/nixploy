import { createServer } from "node:http";
import { setupWebSocketServer } from "@nixploy/server/ws";
import next from "next";

/**
 * Boot the cron registries (database/volume backups + container schedules).
 * The @nixploy/server package does not export a `./modules/*` subpath, so we
 * import the source files directly — tsx resolves them to the same realpath
 * as the package specifiers used by the tRPC routers, keeping a single module
 * instance. Failures are logged but must not prevent the web server from
 * starting.
 */
async function initBackgroundSchedules() {
	const jobs: Array<[string, () => Promise<unknown>]> = [
		[
			"backup schedules",
			async () => {
				const { initBackupSchedules } = await import(
					"../../packages/server/src/modules/backups/scheduler"
				);
				await initBackupSchedules();
			},
		],
		[
			"service schedules",
			async () => {
				const { initSchedules } = await import("../../packages/server/src/modules/schedules/index");
				await initSchedules();
			},
		],
		[
			"metrics history",
			async () => {
				const { initMetricsHistory } = await import(
					"../../packages/server/src/modules/monitoring/history"
				);
				initMetricsHistory();
			},
		],
		[
			"status reconciler",
			async () => {
				const { initStatusReconciler } = await import(
					"../../packages/server/src/modules/deployment/reconciler"
				);
				initStatusReconciler();
			},
		],
		[
			"deployment maintenance",
			async () => {
				const { initDeploymentMaintenance } = await import(
					"../../packages/server/src/modules/deployment/maintenance"
				);
				initDeploymentMaintenance();
			},
		],
		[
			"update checker",
			async () => {
				const { initUpdateChecker } = await import(
					"../../packages/server/src/modules/updates/scheduler"
				);
				await initUpdateChecker();
			},
		],
	];
	for (const [label, start] of jobs) {
		try {
			await start();
			console.log(`▲ Initialized ${label}`);
		} catch (error) {
			console.error(`Failed to initialize ${label}:`, error);
		}
	}
}

/**
 * The deploy queue is in-memory, so anything in flight when this process last
 * stopped is gone. Fail those rows before serving traffic: they would
 * otherwise show as "running" forever and block the status reconciler.
 */
async function recoverDeployments() {
	try {
		const { recoverInterruptedDeployments } = await import(
			"../../packages/server/src/modules/deployment/recovery"
		);
		const count = await recoverInterruptedDeployments();
		if (count > 0) {
			console.log(`▲ Marked ${count} interrupted deployment(s) as failed`);
		}
	} catch (error) {
		console.error("Failed to recover interrupted deployments:", error);
	}
}

/**
 * Bring up the Traefik reverse proxy on boot so local dev gets a working
 * proxy without manual setup. Skipped when NIXPLOY_DISABLE_TRAEFIK_BOOT is
 * set or the docker socket is unreachable (e.g. UI-only dev); failures are
 * logged but never prevent the web server from starting.
 */
async function initTraefik() {
	if (process.env.NIXPLOY_DISABLE_TRAEFIK_BOOT) {
		console.log("▲ Traefik boot skipped (NIXPLOY_DISABLE_TRAEFIK_BOOT is set)");
		return;
	}
	try {
		const { execAsync } = await import("../../packages/server/src/utils/exec");
		await execAsync("docker info", { timeout: 10_000 });
	} catch {
		console.log("▲ Traefik boot skipped (docker socket unreachable)");
		return;
	}
	try {
		const { ensureTraefikSetup } = await import("../../packages/server/src/modules/traefik/setup");
		await ensureTraefikSetup();
		console.log("▲ Traefik reverse proxy ready");
	} catch (error) {
		console.error("Failed to initialize Traefik:", error);
	}
}

const dev = process.env.NODE_ENV !== "production";
// Never use process.env.HOSTNAME — Docker/Swarm sets it to the container id,
// which makes server.listen() bind to a single overlay IP. Host-published
// ports then refuse connections (ERR_CONNECTION_REFUSED on :3000).
const listenHost = process.env.LISTEN_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname: listenHost, port });
const handle = app.getRequestHandler();

async function main() {
	await app.prepare();

	const server = createServer((req, res) => {
		void handle(req, res);
	});

	// WebSocket endpoints: /ws/deployment, /ws/logs, /ws/stats, /ws/terminal.
	setupWebSocketServer(server);

	await recoverDeployments();
	await initBackgroundSchedules();
	await initTraefik();

	server.listen(port, listenHost, () => {
		console.log(`▲ Nixploy ready on http://${listenHost}:${port}`);
	});
}

void main();
