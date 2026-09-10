import type { DeploymentLogger } from "./logger";

export interface DeploymentRunOptions {
	cwd?: string;
	/**
	 * Run on the Nixploy host even when the job is pinned to a server. Swarm
	 * SERVICE-level commands (`docker stack deploy`) only work on the primary
	 * manager; builds and clones stay on `serverId`.
	 */
	onPrimary?: boolean;
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
}
