import { createServer, type Server } from "node:http";
import { createLogger } from "@nixploy/server/lib/logger";
// Stateful server modules are imported by relative path on purpose (same
// module instance as the tRPC/cron graph under tsx) — see server.ts.
import { DEFAULT_WORKER_PORT, describeProcessRole } from "../../packages/server/src/lib/role";
import { shutdownGraceMs, stopScheduledJobs } from "../../packages/server/src/lib/shutdown";
import { stopEventBridge } from "../../packages/server/src/modules/deployment/notify";
import { drainQueue } from "../../packages/server/src/modules/deployment/queue";
import { closeAllSshConnections } from "../../packages/server/src/utils/ssh-pool";

/**
 * `nixploy-worker` — the background half of a split install.
 *
 * With `NIXPLOY_ROLE=worker` this process owns everything that is NOT a
 * request surface: boot recovery of interrupted deployments, the durable
 * queue's claim loop, every node-schedule cron and the Traefik bootstrap. It
 * runs no Next.js at all; the only HTTP it serves is `/api/health`,
 * `/api/ready` and `/api/version` on `PORT` (default 3001) so Swarm can
 * health-check it exactly like the panel.
 *
 * Why Traefik boot lives here and not in the panel: the worker already writes
 * dynamic YAML on every deploy, so it must have the config volume and the
 * docker socket regardless. The panel writes domain YAML on domain mutations
 * too and therefore also mounts the volume — but only one process should be
 * responsible for *provisioning* the proxy, and the worker is the one that is
 * guaranteed to be able to (`docker service create` needs the socket).
 *
 * This module is also imported by `server.ts`: role `all` runs
 * {@link startBackgroundWork} in-process (today's single-process behaviour)
 * and role `worker` hands straight over to {@link runWorkerProcess}. Importing
 * it never starts anything — only the two exported entry points do.
 */

const log = createLogger("worker");

const describeError = (error: unknown): Record<string, unknown> =>
	error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) };

/**
 * Boot the cron registries (database/volume backups + container schedules).
 * The @nixploy/server package does not export a `./modules/*` subpath, so we
 * import the source files directly — tsx resolves them to the same realpath
 * as the package specifiers used by the tRPC routers, keeping a single module
 * instance. Failures are logged but must not prevent the process from coming
 * up: a broken cron must not take the deploy queue with it.
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
			"docker image auto-update",
			async () => {
				const { initImageAutoUpdate } = await import(
					"../../packages/server/src/modules/deployment/auto-update"
				);
				await initImageAutoUpdate();
			},
		],
		[
			"platform alerts",
			async () => {
				const { startPlatformAlerts } = await import(
					"../../packages/server/src/modules/monitoring/platform-alerts"
				);
				startPlatformAlerts();
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
 * The queue itself lives in Postgres, but the BUILDS do not: anything that was
 * running when this process last stopped died with it. Fail those rows before
 * claiming anything new (they would otherwise show as "running" forever, block
 * the status reconciler and hold the queue's per-app mutex). Rows still
 * `queued` are left exactly as they are — the claim loop picks them up in
 * order, which is what makes the backlog survive a restart.
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
			console.log(`▲ ${requeued} queued deployment(s) waiting — the worker will claim them`);
		}
	} catch (error) {
		console.error("Failed to recover interrupted deployments:", error);
	}
}

/**
 * Bring up the Traefik reverse proxy on boot so local dev gets a working
 * proxy without manual setup. Skipped when NIXPLOY_DISABLE_TRAEFIK_BOOT is
 * set or the docker socket is unreachable (e.g. UI-only dev); failures are
 * logged but never prevent the process from starting.
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
 * Everything the worker role owns, in boot order. Called by `server.ts` for
 * role `all` (unchanged single-process behaviour) and by
 * {@link runWorkerProcess} for role `worker`.
 */
export async function startBackgroundWork(): Promise<void> {
	// Registering the job runner is a SIDE EFFECT of importing the deploy engine
	// (`modules/deployment/index.ts` → `./worker` → `setJobRunner`), and the
	// claim loop refuses to claim while that runner is null. Under `server.ts`
	// this used to happen by accident — Next's route bundle imports the engine
	// when the first tRPC/REST request lands, and a deploy is always enqueued
	// through one — so a backlog found at boot sat `queued` until some request
	// happened to pull the module in. `worker.ts` has no routes at all, so
	// nothing would ever have imported it. Do it explicitly, first.
	await import("../../packages/server/src/modules/deployment/index");
	const { startEventBridge } = await import("../../packages/server/src/modules/deployment/notify");
	// Subscribe BEFORE recovery so a cancel/enqueue published while we boot is
	// not lost between the claim loop starting and the bridge coming up.
	await startEventBridge();
	await recoverDeployments();
	await initBackgroundSchedules();
	await initTraefik();
}

/** Result of a worker-side graceful shutdown (mirrors the panel's log line). */
export interface BackgroundShutdownResult {
	crons: { jobs: number; timedOut: boolean };
	queue: { completed: number; interrupted: number };
}

/**
 * Stop the background half: no new claims, crons cancelled, running builds
 * given `NIXPLOY_SHUTDOWN_GRACE_MS` and then cancelled + finalized as `error`.
 * Queued rows stay `queued` and the next boot claims them.
 */
export async function stopBackgroundWork(
	graceMs = shutdownGraceMs(),
): Promise<BackgroundShutdownResult> {
	// Flip the queue to draining first (synchronous) so nothing new starts
	// while the crons wind down; the wait happens below.
	const drained = drainQueue({ graceMs });
	const crons = await stopScheduledJobs();
	const queue = await drained;
	await stopEventBridge();
	// Pooled SSH connections to managed servers are process-wide; close them
	// so a Swarm restart does not leave half-open TCP sessions on the hosts.
	closeAllSshConnections();
	return { crons, queue };
}

/* -------------------------------------------------------------------------- */
/*  Standalone worker process                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Health surface of the worker. It serves no UI and no API, but Swarm needs
 * something to probe — and an operator needs a way to tell "the worker is
 * wedged" from "the worker is gone". Same paths and same JSON as the panel's
 * route handlers so `nixploy doctor`, install.sh and update.sh can reuse their
 * probes verbatim.
 */
function createHealthServer(): Server {
	return createServer((req, res) => {
		void (async () => {
			const path = new URL(req.url ?? "/", "http://localhost").pathname;
			const json = (status: number, body: unknown) => {
				const payload = JSON.stringify(body);
				res.writeHead(status, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store",
					"content-length": Buffer.byteLength(payload),
				});
				res.end(payload);
			};
			try {
				if (path === "/api/health") {
					json(200, { ok: true, role: "worker", uptimeSeconds: Math.round(process.uptime()) });
					return;
				}
				if (path === "/api/ready") {
					const { checkReadiness } = await import(
						"../../packages/server/src/modules/observability/health"
					);
					const report = await checkReadiness();
					json(report.ok ? 200 : 503, { ...report, role: "worker" });
					return;
				}
				if (path === "/api/version") {
					const { getVersionInfo } = await import(
						"../../packages/server/src/modules/observability/health"
					);
					json(200, { ...getVersionInfo(), role: "worker" });
					return;
				}
				json(404, { error: "Not found" });
			} catch (error) {
				// The reason belongs in the worker log, not in a response anyone
				// who can reach the port can read.
				console.error("[worker] health probe failed:", error);
				json(503, { ok: false, error: "Readiness check failed — see the worker log" });
			}
		})();
	});
}

/** Extra time past the deploy grace before the backstop gives up on a hung shutdown. */
const SHUTDOWN_BACKSTOP_EXTRA_MS = 30_000;

function registerProcessGuards(): void {
	process.on("unhandledRejection", (reason) => {
		log.error("Unhandled promise rejection", describeError(reason));
	});
	process.on("uncaughtException", (error, origin) => {
		log.error(`Uncaught exception (${origin}) — exiting`, describeError(error));
		process.exit(1);
	});
}

function registerShutdownHandlers(server: Server): void {
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
			server.close();
			server.closeIdleConnections();
			const result = await stopBackgroundWork(graceMs);
			log.info("Scheduled jobs stopped", { ...result.crons });
			log.info("Deploy queue drained", { ...result.queue });
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

/** Run this process as `nixploy-worker`. */
export async function runWorkerProcess(): Promise<void> {
	registerProcessGuards();
	const listenHost = process.env.LISTEN_HOST ?? "0.0.0.0";
	const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_WORKER_PORT), 10);

	const server = createHealthServer();
	registerShutdownHandlers(server);

	await startBackgroundWork();

	server.listen(port, listenHost, () => {
		console.log(
			`▲ Nixploy worker ready on http://${listenHost}:${port} — ${describeProcessRole("worker")}`,
		);
	});
}

/**
 * Running `tsx worker.ts` directly (docs, local testing, a Swarm service whose
 * command is overridden) starts the worker. Importing it from `server.ts` does
 * not — role `all` only wants {@link startBackgroundWork}.
 */
const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("/worker.ts");
if (invokedDirectly) {
	void runWorkerProcess();
}
