import type { DeploymentLogger } from "./logger";

/**
 * Execution context handed to sources and builders by the worker.
 * `run` executes a shell command on the target server (local bash or SSH),
 * streams output into the deployment log, and registers the child process
 * so `cancelDeployment` can kill it mid-build.
 */
export interface DeploymentContext {
	serverId: string | null;
	logger: DeploymentLogger;
	run: (command: string, opts?: { cwd?: string }) => Promise<void>;
}
