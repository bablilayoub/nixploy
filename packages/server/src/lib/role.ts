/**
 * Process roles (`NIXPLOY_ROLE`).
 *
 * Nixploy ships as ONE image that can run in three shapes:
 *
 * - `all` (default) — exactly what a single-process install has always done:
 *   Next + tRPC + REST + MCP + WebSockets **and** the deploy claim loop, the
 *   crons, boot recovery and the Traefik bootstrap, in one Node process.
 * - `panel` — the request surfaces only. It still *enqueues* deployments and
 *   writes Traefik YAML on domain mutations (it shares the config volume), but
 *   it never claims a job and runs no cron.
 * - `worker` — no Next at all (`apps/web/worker.ts`): boot recovery, the claim
 *   loop, every cron and the Traefik bootstrap, plus a tiny HTTP listener that
 *   answers `/api/health` and `/api/ready` so Swarm can health-check it.
 *
 * The split is opt-in (`install.sh --split-worker`); the default install is
 * unchanged. Anything that "runs in the background" asks {@link isWorkerRole},
 * anything that serves a request asks {@link isPanelRole}, and the two are
 * both true for `all` — which is why adding a role never changes the default
 * behaviour.
 *
 * An unknown value is NOT fatal: a typo in a Swarm env var would otherwise
 * take the panel down. It falls back to `all` (the safe superset) and says so
 * once.
 */

export const PROCESS_ROLES = ["all", "panel", "worker"] as const;

export type ProcessRole = (typeof PROCESS_ROLES)[number];

/** Port the worker's health listener binds when `PORT` is unset. */
export const DEFAULT_WORKER_PORT = 3001;

/** Parse a raw `NIXPLOY_ROLE` value. Unknown / empty → `all`. */
export function parseProcessRole(raw: string | null | undefined): ProcessRole {
	const value = raw?.trim().toLowerCase();
	if (!value) return "all";
	return (PROCESS_ROLES as readonly string[]).includes(value) ? (value as ProcessRole) : "all";
}

/** True when `raw` is set to something that is not a role (worth warning about). */
export function isUnknownProcessRole(raw: string | null | undefined): boolean {
	const value = raw?.trim().toLowerCase();
	return Boolean(value) && !(PROCESS_ROLES as readonly string[]).includes(value as string);
}

/**
 * This process's role. Read from the environment on every call on purpose —
 * the value is cheap, and tests flip `process.env.NIXPLOY_ROLE` between cases.
 */
export function processRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
	return parseProcessRole(env.NIXPLOY_ROLE);
}

/** Serves HTTP/WebSocket traffic: `all` and `panel`. */
export function isPanelRole(env: NodeJS.ProcessEnv = process.env): boolean {
	return processRole(env) !== "worker";
}

/** Runs deployments and crons: `all` and `worker`. */
export function isWorkerRole(env: NodeJS.ProcessEnv = process.env): boolean {
	return processRole(env) !== "panel";
}

/**
 * True when the two halves live in different processes, i.e. the local
 * EventEmitter is no longer enough and Postgres `LISTEN/NOTIFY` has to carry
 * the wake-ups (`modules/deployment/notify.ts`).
 */
export function isSplitRole(env: NodeJS.ProcessEnv = process.env): boolean {
	return processRole(env) !== "all";
}

/** Human label for boot logs. */
export function describeProcessRole(role: ProcessRole = processRole()): string {
	switch (role) {
		case "panel":
			return "panel (HTTP/WS only — deployments run in nixploy-worker)";
		case "worker":
			return "worker (deploy queue + crons, no HTTP surface)";
		default:
			return "all (single process: HTTP/WS + deploy queue + crons)";
	}
}
