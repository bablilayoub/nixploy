import { readFile } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { deployments, domains } from "../../db/schema";
import { inspectServiceState } from "../databases/engine";
import { deploymentEvents } from "./events";
import { getQueuePosition } from "./queue";
import { type DeployStep, isDeployStep } from "./steps";

/**
 * The machine-readable answer to "did my deploy work?".
 *
 * Everything a script, an agent or `--wait` needs in one object: the verdict,
 * where it failed, the tail of the log, the URLs it should now answer on, and
 * whether Swarm actually has tasks running. Built once here so the tRPC
 * procedure, the REST adapter, the CLI and the MCP tools cannot drift into
 * four slightly different shapes.
 */

/** Lines of the build log carried with an outcome. */
export const DEFAULT_LOG_LINES = 30;
export const MAX_LOG_LINES = 200;
/** Cap on the tail read from disk; a build log can be megabytes. */
const LOG_TAIL_BYTES = 256 * 1024;

export type DeploymentOutcomeStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface DeploymentHealth {
	/** Tasks Swarm reports as running. */
	running: number;
	/** Replicas the service asks for. */
	desired: number;
	/**
	 * `healthy` — every desired replica runs. `degraded` — some do.
	 * `down` — none do, or the service does not exist. `unknown` — the daemon
	 * could not be read, which is NOT the same as "down" and must not be
	 * reported as one.
	 */
	state: "healthy" | "degraded" | "down" | "unknown";
}

export interface DeploymentOutcome {
	deploymentId: string;
	status: DeploymentOutcomeStatus;
	/** False while the row is still `queued` or `running`. */
	done: boolean;
	/** True only for `done` — a cancelled deploy is finished, not successful. */
	ok: boolean;
	/** 1-based position in its server's line, while queued. */
	queuePosition: number | null;
	/** The phase it is in, or died in (`./steps.ts`). */
	step: DeployStep | null;
	/** The phase it died in — `step`, but only when the deploy failed. */
	failingStep: DeployStep | null;
	errorMessage: string | null;
	startedAt: Date | null;
	finishedAt: Date | null;
	/** Milliseconds from claim to terminal state, or to now while running. */
	durationMs: number | null;
	commitSha: string | null;
	requestedRef: string | null;
	trigger: string | null;
	isPreview: boolean;
	service: {
		kind: "application" | "compose";
		id: string;
		appName: string | null;
	} | null;
	/** Public URLs of the service, from its domains. */
	urls: string[];
	/** Tail of the build log, oldest line first. */
	lastLogLines: string[];
	/** Live Swarm state — only read once the deploy is finished. */
	health: DeploymentHealth | null;
}

const isActive = (status: string): boolean => status === "queued" || status === "running";

/** Last `count` non-empty lines of a log file, oldest first. Missing file → []. */
export async function readLogTail(logPath: string | null, count: number): Promise<string[]> {
	if (!logPath || count <= 0) return [];
	let raw: string;
	try {
		raw = await readFile(logPath, "utf8");
	} catch {
		return [];
	}
	// A build log has no upper bound; only the tail can possibly be wanted.
	const tail = raw.length > LOG_TAIL_BYTES ? raw.slice(-LOG_TAIL_BYTES) : raw;
	const lines = tail.split("\n").filter((line) => line.trim().length > 0);
	return lines.slice(-count);
}

/** `https://host/path` for each domain of the service, deduplicated. */
export function domainUrls(
	rows: ReadonlyArray<{ host: string; path: string | null; https: boolean }>,
): string[] {
	const urls = new Set<string>();
	for (const row of rows) {
		if (!row.host) continue;
		const path = row.path && row.path !== "/" ? row.path : "";
		urls.add(`${row.https ? "https" : "http"}://${row.host}${path}`);
	}
	return [...urls];
}

/**
 * Swarm's view of the service. Returns `unknown` rather than `down` when the
 * daemon cannot be read: "I could not look" and "nothing is running" are
 * different answers, and reporting the second for the first is how a healthy
 * deploy gets called a failure.
 */
export async function readDeploymentHealth(appName: string): Promise<DeploymentHealth> {
	try {
		const state = await inspectServiceState(appName);
		if (!state.exists) return { running: 0, desired: 0, state: "down" };
		const healthy = state.desired > 0 && state.running >= state.desired;
		return {
			running: state.running,
			desired: state.desired,
			state: healthy ? "healthy" : state.running > 0 ? "degraded" : "down",
		};
	} catch {
		return { running: 0, desired: 0, state: "unknown" };
	}
}

type DeploymentWithParents = typeof deployments.$inferSelect & {
	application?: { applicationId: string; appName: string } | null;
	compose?: { composeId: string; appName: string; composeType: string } | null;
};

/**
 * Assemble the outcome for a deployment row the caller has already been
 * authorised for.
 *
 * `health` is read only once the deploy is finished and only for a Swarm-backed
 * service: mid-flight the counts describe the version being replaced, which
 * would read as a false "degraded", and a plain (non-stack) compose project has
 * no Swarm service to inspect at all.
 */
export async function buildDeploymentOutcome(
	deployment: DeploymentWithParents,
	options: { logLines?: number } = {},
): Promise<DeploymentOutcome> {
	const status = deployment.status as DeploymentOutcomeStatus;
	const done = !isActive(status);
	const step = isDeployStep(deployment.currentStep) ? deployment.currentStep : null;

	const applicationId = deployment.applicationId;
	const composeId = deployment.composeId;
	const service: DeploymentOutcome["service"] = applicationId
		? { kind: "application", id: applicationId, appName: deployment.appName }
		: composeId
			? { kind: "compose", id: composeId, appName: deployment.appName }
			: null;

	// Preview domains carry `previewDeploymentId`; a production deploy's URLs
	// must not include them, and a preview's must not include production's.
	const domainRows = service
		? await db.query.domains.findMany({
				where: and(
					service.kind === "application"
						? eq(domains.applicationId, service.id)
						: eq(domains.composeId, service.id),
					deployment.previewDeploymentId
						? eq(domains.previewDeploymentId, deployment.previewDeploymentId)
						: isNull(domains.previewDeploymentId),
				),
				columns: { host: true, path: true, https: true },
			})
		: [];

	const swarmBacked =
		Boolean(deployment.application) || deployment.compose?.composeType === "stack";
	const health =
		done && deployment.appName && swarmBacked
			? await readDeploymentHealth(deployment.appName)
			: null;

	const startedAt = deployment.startedAt ?? null;
	const finishedAt = deployment.finishedAt ?? null;
	const durationMs = startedAt ? (finishedAt ?? new Date()).getTime() - startedAt.getTime() : null;

	return {
		deploymentId: deployment.deploymentId,
		status,
		done,
		ok: status === "done",
		queuePosition: status === "queued" ? getQueuePosition(deployment.deploymentId) : null,
		step,
		failingStep: status === "error" ? step : null,
		errorMessage: deployment.errorMessage ?? null,
		startedAt,
		finishedAt,
		durationMs,
		commitSha: deployment.commitSha ?? null,
		requestedRef: deployment.requestedRef ?? null,
		trigger: deployment.trigger ?? null,
		isPreview: deployment.isPreview,
		service,
		urls: domainUrls(domainRows),
		lastLogLines: await readLogTail(
			deployment.logPath,
			Math.min(options.logLines ?? DEFAULT_LOG_LINES, MAX_LOG_LINES),
		),
		health,
	};
}

/* -------------------------------------------------------------------------- */
/*  Long poll                                                                 */
/* -------------------------------------------------------------------------- */

/** Ceiling on one `wait` call; past this a proxy or a browser gives up anyway. */
export const MAX_WAIT_MS = 55_000;

type DeploymentRow = typeof deployments.$inferSelect;
/**
 * Safety-net re-read interval.
 *
 * The `finish` event is the fast path, but it is an in-process emitter (bridged
 * over `LISTEN/NOTIFY` in a split). If a notification is ever lost — a dropped
 * Postgres connection, a worker killed between the DB write and the publish —
 * a caller waiting only on the event would hang for the whole timeout while the
 * row has been terminal for a minute. Re-reading costs one indexed lookup.
 */
const POLL_INTERVAL_MS = 2_000;

/**
 * Block until the deployment reaches a terminal state, `timeoutMs` elapses, or
 * the row disappears. Resolves with the final row; the caller decides what to
 * report, so a timeout is simply "still running" rather than an error.
 */
export async function waitForDeployment(
	deploymentId: string,
	timeoutMs: number,
): Promise<DeploymentRow | undefined> {
	const deadline = Date.now() + Math.min(Math.max(timeoutMs, 0), MAX_WAIT_MS);

	const read = (): Promise<DeploymentRow | undefined> =>
		db.query.deployments.findFirst({ where: eq(deployments.deploymentId, deploymentId) });

	const initial = await read();
	if (!initial || !isActive(initial.status)) return initial;

	return await new Promise<DeploymentRow | undefined>((resolve) => {
		let settled = false;
		let timer: NodeJS.Timeout | null = null;

		const finish = (value: DeploymentRow | undefined) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			deploymentEvents.off("finish", onFinish);
			resolve(value);
		};

		function onFinish(event: { deploymentId: string }) {
			if (event.deploymentId !== deploymentId) return;
			// The event fires after the row is written, but read it again rather
			// than trusting the payload: the outcome needs the whole row.
			void read().then(finish);
		}

		deploymentEvents.on("finish", onFinish);

		const tick = async () => {
			if (settled) return;
			if (Date.now() >= deadline) {
				finish(await read());
				return;
			}
			const current = await read();
			if (!current || !isActive(current.status)) {
				finish(current);
				return;
			}
			timer = setTimeout(() => void tick(), Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
			timer.unref();
		};
		void tick();
	});
}
