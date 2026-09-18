import { createServer, type Server } from "node:http";
import { createLogger } from "@nixploy/server/lib/logger";
import { closeWebSocketServer, setupWebSocketServer } from "@nixploy/server/ws";
import next from "next";
// Stateful server modules are imported by relative path on purpose (same
// module instance as the tRPC/cron graph under tsx) — see startBackgroundWork.
import { initAuth } from "../../packages/server/src/lib/auth";
import {
	describeProcessRole,
	isUnknownProcessRole,
	isWorkerRole,
	processRole,
} from "../../packages/server/src/lib/role";
import { shutdownGraceMs } from "../../packages/server/src/lib/shutdown";
import { startAuthRebuildBridge } from "../../packages/server/src/modules/auth/sso-notify";
import { startEventBridge } from "../../packages/server/src/modules/deployment/notify";
import { PEER_IP_HEADER } from "../../packages/server/src/utils/rate-limit";
// Importing worker.ts starts nothing — it only exports the background half
// (claim loop, crons, boot recovery, Traefik) that role `all` runs in-process
// and role `worker` runs on its own.
import { runWorkerProcess, startBackgroundWork, stopBackgroundWork } from "./worker";

const log = createLogger("server");

const describeError = (error: unknown): Record<string, unknown> =>
	error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) };

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
 *
 * In role `panel` steps 1, 2 and 4 belong to `nixploy-worker` instead
 * (`stopBackgroundWork` is a no-op there — this process owns no queue and no
 * cron), so a panel restart closes sockets and exits in milliseconds while
 * builds keep running. That is the whole point of the split.
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
		log.info(`Received ${signal}: shutting down gracefully`, { graceMs, role: processRole() });
		const backstop = setTimeout(() => {
			log.error("Shutdown backstop reached — exiting");
			process.exit(1);
		}, graceMs + SHUTDOWN_BACKSTOP_EXTRA_MS);
		backstop.unref();

		try {
			// Flip the queue to draining first (synchronous) so nothing new
			// starts while the rest winds down; the wait happens below.
			const background = isWorkerRole() ? stopBackgroundWork(graceMs) : null;
			server.close();
			server.closeIdleConnections();
			log.info("HTTP server stopped accepting connections");

			const sockets = await closeWebSocketServer();
			log.info("WebSocket server closed", { connections: sockets });

			if (background) {
				const result = await background;
				log.info("Scheduled jobs stopped", { ...result.crons });
				log.info("Deploy queue drained", { ...result.queue });
			} else {
				const { stopEventBridge } = await import(
					"../../packages/server/src/modules/deployment/notify"
				);
				await stopEventBridge();
				// Role `panel` still talks to managed servers (log/stats/terminal
				// streams) over the pooled SSH connections; close them too.
				const { closeAllSshConnections } = await import("../../packages/server/src/utils/ssh-pool");
				closeAllSshConnections();
			}

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
	if (isUnknownProcessRole(process.env.NIXPLOY_ROLE)) {
		console.warn(
			`▲ Unknown NIXPLOY_ROLE "${process.env.NIXPLOY_ROLE}" — falling back to "all" (valid: all, panel, worker)`,
		);
	}
	// The production image has one CMD. `NIXPLOY_ROLE=worker` is all it takes
	// to turn the same container into nixploy-worker: no Next, no HTTP surface
	// beyond the health endpoints.
	if (processRole() === "worker") {
		await runWorkerProcess();
		return;
	}

	registerProcessGuards();
	await app.prepare();

	const server = createServer((req, res) => {
		// The Fetch `Request` a route handler receives carries no socket, so
		// the real TCP peer travels as a header: `clientIpFromRequest` only
		// trusts forwarded headers when the peer is itself a trusted proxy
		// (security audit 2.10). Drop any client-supplied copy first — this
		// header must never be attacker-controlled.
		delete req.headers[PEER_IP_HEADER];
		const peer = req.socket.remoteAddress;
		if (peer) req.headers[PEER_IP_HEADER] = peer;
		void handle(req, res);
	});
	registerShutdownHandlers(server);

	// WebSocket endpoints: /ws/deployment, /ws/events, /ws/logs, /ws/stats, /ws/terminal.
	setupWebSocketServer(server);

	// SSO providers live in the database, and better-auth freezes its plugin
	// array at construction — so the instance built at import time has none and
	// is swapped for a configured one here. Password sign-in works throughout.
	// Both roles do this: the panel serves the login page, and the worker's own
	// auth instance is what API-key and session checks run against.
	await initAuth();
	await startAuthRebuildBridge();

	if (isWorkerRole()) {
		// Role `all`: the deploy queue, the crons, boot recovery and the Traefik
		// bootstrap run right here, exactly as they always have.
		await startBackgroundWork();
	} else {
		// Role `panel`: nixploy-worker owns all of that. This process still has
		// to LISTEN so deployment transitions published there reach `/ws/events`
		// and close `/ws/deployment` log streams.
		await startEventBridge();
	}

	server.listen(port, listenHost, () => {
		console.log(`▲ Nixploy ready on http://${listenHost}:${port} — ${describeProcessRole()}`);
		// Fire-and-forget: tell channels subscribed to `nixployRestart` we are up.
		void import("../../packages/server/src/modules/notifications/index").then((m) =>
			m.emitInstanceRestartNotification(),
		);
	});
}

void main();
