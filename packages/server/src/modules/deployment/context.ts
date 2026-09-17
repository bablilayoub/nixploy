import type { DeploymentLogger } from "./logger";
import type { DeployStep } from "./steps";

export interface DeploymentRunOptions {
	cwd?: string;
	/**
	 * Run on the Nixploy host even when the job is pinned to a server. Swarm
	 * SERVICE-level commands (`docker stack deploy`) only work on the primary
	 * manager; builds and clones stay on `serverId`.
	 */
	onPrimary?: boolean;
	/**
	 * Per-command deadline. Defaults to the spawn helper's own timeout; the
	 * deploy hooks pass `NIXPLOY_HOOK_TIMEOUT_MS` so a wedged migration cannot
	 * sit on the queue slot for the whole deployment budget.
	 */
	timeoutMs?: number;
}

/**
 * Execution context handed to sources and builders by the worker.
 * `run` executes a shell command on the target server (local bash or SSH),
 * streams output into the deployment log, and registers the child process
 * so `cancelDeployment` can kill it mid-build.
 */
export interface DeploymentContext {
	serverId: string | null;
	logger: DeploymentLogger;
	run: (command: string, opts?: DeploymentRunOptions) => Promise<void>;
	/**
	 * Record which phase the job has reached (`deployment.current_step`), so a
	 * failure can report *where* it failed without anything parsing the log.
	 * Best-effort: a step that fails to persist must never fail a deploy.
	 */
	step: (step: DeployStep) => Promise<void>;
}
