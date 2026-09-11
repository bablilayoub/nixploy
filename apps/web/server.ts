import { createServer, type Server } from "node:http";
import { createLogger } from "@nixploy/server/lib/logger";
import { closeWebSocketServer, setupWebSocketServer } from "@nixploy/server/ws";
import next from "next";
// Stateful server modules are imported by relative path on purpose (same
// module instance as the tRPC/cron graph under tsx) — see initBackgroundSchedules.
import { shutdownGraceMs, stopScheduledJobs } from "../../packages/server/src/lib/shutdown";
import { drainQueue } from "../../packages/server/src/modules/deployment/queue";

const log = createLogger("server");

const describeError = (error: unknown): Record<string, unknown> =>
	error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) };

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
		[
			"uptime probes",
			async () => {
				const { initUptimeProbes } = await import(
					"../../packages/server/src/modules/observability/index"
				);
				await initUptimeProbes();
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
 * The deploy queue is in-memory, so anything that was *building* when this
 * process last stopped is gone: fail those rows before serving traffic (they
 * would otherwise show as "running" forever and block the status
 * reconciler). Rows that were still `queued` never started and are put back
 * on the queue, so a restart keeps the backlog.
 */
async function recoverDeployments() {
	try {
		const { recoverInterruptedDeployments } = await import(
			"../../packages/server/src/modules/deployment/recovery"
		);
		const { interrupted, requeued } = await recoverInterruptedDeployments();
		if (interrupted > 0) {
			console.log(`▲ Marked ${interrupted} interrupted deployment(s) as failed`);
		}
		if (requeued > 0) {
			console.log(`▲ Re-queued ${requeued} deployment(s) left waiting by the last shutdown`);
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
	const TRAEFIK_BOOT_TIMEOUT_MS = 45_000;
	try {
		const { ensureTraefikSetup } = await import("../../packages/server/src/modules/traefik/setup");
		await Promise.race([
			ensureTraefikSetup(),
			new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error(`Traefik boot timed out after ${TRAEFIK_BOOT_TIMEOUT_MS}ms`)),
					TRAEFIK_BOOT_TIMEOUT_MS,
				);
			}),
		]);
		console.log("▲ Traefik reverse proxy ready");
	} catch (error) {
		console.error("Failed to initialize Traefik:", error);
	}
}

/**
 * Crash guard. One stray rejection in a cron or WS handler used to take the
 * whole process (UI + API + queue + crons) down; now it is logged and the
 * process carries on. A synchronous uncaught exception leaves state unknown,
 * so that one still exits (non-zero → Swarm restarts the task).
 */
function registerProcessGuards() {
	process.on("unhandledRejection", (reason) => {
		log.error("Unhandled promise rejection", describeError(reason));
	});
	process.on("uncaughtException", (error, origin) => {
		log.error(`Uncaught exception (${origin}) — exiting`, describeError(error));
		process.exit(1);
	});
}

/** Extra time past the deploy grace before the backstop gives up on a hung shutdown. */
const SHUTDOWN_BACKSTOP_EXTRA_MS = 30_000;

/**
 * Graceful shutdown on SIGTERM/SIGINT (Swarm updates, `update.sh`, Ctrl-C):
 *   1. stop dequeuing deployments and stop accepting HTTP connections,
 *   2. cancel the node-schedule crons (bounded wait for a running tick),
 *   3. close websocket clients with 1001 so they reconnect after the restart,
 *   4. wait up to NIXPLOY_SHUTDOWN_GRACE_MS for running deployments; whatever
 *      is still building is cancelled and finalized as `error`
 *      ("Interrupted by panel shutdown"),
 *   5. exit 0. Queued rows stay `queued` and are re-enqueued at next boot.
 * A second signal forces an immediate exit.
 */
function registerShutdownHandlers(server: Server) {
	let shuttingDown = false;

	const shutdown = async (signal: NodeJS.Signals) => {
		if (shuttingDown) {
			log.warn(`Received ${signal} during shutdown — forcing exit`);
			process.exit(1);
		}
		shuttingDown = true;
		const graceMs = shutdownGraceMs();
		log.info(`Received ${signal}: shutting down gracefully`, { graceMs });
		const backstop = setTimeout(() => {
			log.error("Shutdown backstop reached — exiting");
			process.exit(1);
		}, graceMs + SHUTDOWN_BACKSTOP_EXTRA_MS);
		backstop.unref();

		try {
			// Flip the queue to draining first (synchronous) so nothing new
			// starts while the rest winds down; the wait happens in step 4.
			const drained = drainQueue({ graceMs });
			server.close();
			server.closeIdleConnections();
			log.info("HTTP server stopped accepting connections");

			const crons = await stopScheduledJobs();
			log.info("Scheduled jobs stopped", { jobs: crons.jobs, timedOut: crons.timedOut });

			const sockets = await closeWebSocketServer();
			log.info("WebSocket server closed", { connections: sockets });

			const result = await drained;
			log.info("Deploy queue drained", { ...result });

			log.info("Shutdown complete");
			process.exit(0);
		} catch (error) {
			log.error("Shutdown failed — exiting", describeError(error));
			process.exit(1);
		}
	};

	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));
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
	registerProcessGuards();
	await app.prepare();

	const server = createServer((req, res) => {
		void handle(req, res);
	});
	registerShutdownHandlers(server);

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
