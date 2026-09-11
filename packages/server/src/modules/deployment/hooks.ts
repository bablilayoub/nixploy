import { execAsync, execAsyncRemote } from "../../utils/exec";
import type { DeploymentContext } from "./context";
import { CommandError, writeFileTargeted } from "./docker";
import { getAppBasePath, shellQuote } from "./paths";
import { DEFAULT_CAPABILITY_ADD, DEFAULT_CAPABILITY_DROP, DEFAULT_PIDS_LIMIT } from "./swarm";

/**
 * Pre/post-deploy hooks (product audit, Deploy #5).
 *
 * - **pre**: a throwaway container from the image this deployment just built,
 *   on the service's own environment overlay, with the merged runtime env
 *   handed over an `--env-file` written 0600 (never on argv, where `ps`
 *   shows it). It runs BEFORE the rollout, so a non-zero exit aborts the
 *   deployment and the previous version keeps serving traffic. Typical use:
 *   `npm run migrate`.
 * - **post**: `docker exec` inside one already-running task, after the
 *   rollout converged. Typical use: cache warm-up, a smoke request.
 *
 * Both inherit the container hardening baseline from `swarm.ts` (cap drop
 * ALL + the standard add list, `no-new-privileges`, a pids ceiling) and both
 * are time-boxed by `NIXPLOY_HOOK_TIMEOUT_MS`.
 */

/** Hook deadline default: `NIXPLOY_HOOK_TIMEOUT_MS` overrides it. */
export const DEFAULT_HOOK_TIMEOUT_MS = 10 * 60 * 1000;

/** Wall-clock budget of one hook command. */
export function hookTimeoutMs(): number {
	const fromEnv = Number.parseInt(process.env.NIXPLOY_HOOK_TIMEOUT_MS ?? "", 10);
	return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_HOOK_TIMEOUT_MS;
}

/** `--cap-drop ALL --cap-add CHOWN …` — the swarm baseline in CLI form. */
export function hardeningFlags(): string {
	return [
		...DEFAULT_CAPABILITY_DROP.map((cap) => `--cap-drop ${cap}`),
		...DEFAULT_CAPABILITY_ADD.map((cap) => `--cap-add ${cap}`),
		"--security-opt no-new-privileges",
		`--pids-limit ${DEFAULT_PIDS_LIMIT}`,
	].join(" ");
}

export interface PreDeployCommandInput {
	/** Image reference the hook runs (the tag this deployment built/pulled). */
	image: string;
	/** Environment overlay the container joins, so it can reach its database. */
	network: string;
	/** Absolute path of the 0600 env file on the target server. */
	envFilePath: string;
	/** Container name, so a timed-out run can still be force-removed. */
	containerName: string;
	/** Tenant-supplied shell command. */
	command: string;
}

/**
 * Exact `docker run` line for a pre-deploy hook.
 *
 * `--entrypoint sh` is load-bearing: without it the image's own ENTRYPOINT
 * receives `sh -c '<command>'` as *arguments*. An image like `traefik/whoami`
 * (`ENTRYPOINT ["/whoami"]`) then ignores them and starts its server instead,
 * so the hook never runs and the container sits there until the hook deadline
 * kills it. Overriding the entrypoint makes the command the command.
 */
export function buildPreDeployCommand(input: PreDeployCommandInput): string {
	return [
		"docker run --rm",
		`--name ${shellQuote(input.containerName)}`,
		`--network ${shellQuote(input.network)}`,
		`--env-file ${shellQuote(input.envFilePath)}`,
		hardeningFlags(),
		"--entrypoint sh",
		shellQuote(input.image),
		`-c ${shellQuote(input.command)}`,
	].join(" ");
}

/** Exact `docker exec` line for a post-deploy hook. */
export function buildPostDeployCommand(containerId: string, command: string): string {
	return `docker exec ${shellQuote(containerId)} sh -c ${shellQuote(command)}`;
}

/** Newest running container carrying `label`, one id per line (first wins). */
export function buildFindContainerCommand(label: string): string {
	return `docker ps --filter ${shellQuote(`label=${label}`)} --filter status=running --format '{{.ID}}'`;
}

/** Swarm task containers of a service carry this label. */
export const swarmServiceLabel = (appName: string): string =>
	`com.docker.swarm.service.name=${appName}`;

/** `docker compose` project containers carry this label. */
export const composeProjectLabel = (appName: string): string =>
	`com.docker.compose.project=${appName}`;

/** `docker stack deploy` containers carry this label instead. */
export const composeStackLabel = (appName: string): string =>
	`com.docker.stack.namespace=${appName}`;

/** `<config>/applications/<appName>/hook-<deploymentId>.env` — 0600, removed after the run. */
export const hookEnvFilePath = (appName: string, deploymentId: string): string =>
	`${getAppBasePath(appName)}/hook-${deploymentId}.env`;

/** `<appName>-hook-<short id>` — docker container names allow `[a-zA-Z0-9_.-]`. */
export function hookContainerName(appName: string, deploymentId: string): string {
	const short = deploymentId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "hook";
	return `${appName}-hook-${short}`.slice(0, 60);
}

const run = (serverId: string | null, command: string): Promise<string> =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

/**
 * A cancelled/killed command must keep its `CommandError` shape: the worker
 * reads `error.killed` to tell a user cancel from a real failure. Everything
 * else is relabelled so the deployment's `errorMessage` names the hook.
 */
function describeHookFailure(label: string, error: unknown): Error {
	if (error instanceof CommandError && error.killed) return error;
	const message = error instanceof Error ? error.message : String(error);
	// 127 from `docker run --entrypoint sh` means the image has no shell
	// (scratch / distroless, e.g. `traefik/whoami`). Say so: a bare
	// "exit 127" sends people hunting through their own command.
	const hint =
		error instanceof CommandError && error.exitCode === 127
			? " — the image has no /bin/sh, so it cannot run a deploy hook (scratch/distroless images need a shell-capable base)"
			: "";
	return new Error(`${label} failed: ${message}${hint}`);
}

export interface RunPreDeployHookInput {
	appName: string;
	deploymentId: string;
	image: string;
	network: string;
	/** Merged runtime env as `KEY=VALUE` lines. */
	env: string;
	command: string;
}

/**
 * Run the pre-deploy hook. Throws on a non-zero exit so the worker aborts
 * before `upsertSwarmService` — the running version is never touched. The
 * env file and a container that outlived its deadline are always cleaned up.
 */
export async function runPreDeployHook(
	ctx: DeploymentContext,
	input: RunPreDeployHookInput,
): Promise<void> {
	const envFilePath = hookEnvFilePath(input.appName, input.deploymentId);
	const containerName = hookContainerName(input.appName, input.deploymentId);
	ctx.logger.line("Running pre-deploy command...");
	// Secrets reach the container through a 0600 file on the target server,
	// never through argv (`ps`) or the docker CLI's own environment.
	await writeFileTargeted(ctx.serverId, envFilePath, `${input.env}\n`, "600");
	try {
		await ctx.run(
			buildPreDeployCommand({
				image: input.image,
				network: input.network,
				envFilePath,
				containerName,
				command: input.command,
			}),
			{ timeoutMs: hookTimeoutMs() },
		);
		ctx.logger.line("Pre-deploy command succeeded");
	} catch (error) {
		throw describeHookFailure("Pre-deploy command", error);
	} finally {
		await run(
			ctx.serverId,
			`docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true; rm -f ${shellQuote(envFilePath)}`,
		).catch(() => {
			// Best effort: `--rm` already removes the container on a clean exit.
		});
	}
}

export interface RunExecHookInput {
	/** Container labels to look through, in order (swarm service, compose project, stack). */
	labels: string[];
	command: string;
	/** Shown in the log when no running container matches. */
	appName: string;
	/** "Pre-deploy command" / "Post-deploy command" — used in log lines and errors. */
	label: string;
	/**
	 * How long to keep looking for a running container. This is the rollout
	 * convergence wait for the post-deploy hook: `service update` returns as
	 * soon as the swarm accepted the spec, so the new task usually needs a few
	 * seconds to start. 0 = look once (compose pre-hook).
	 */
	waitMs?: number;
}

/** Default convergence budget before a post-deploy hook gives up looking. */
export const DEFAULT_HOOK_CONVERGENCE_MS = 120_000;
const CONVERGENCE_POLL_MS = 3_000;

/**
 * Run a hook inside one already-running container. A missing container is a
 * warning, not a failure (a first compose deploy has nothing running yet, and
 * a converged rollout that lost its task is the reconciler's problem); a
 * non-zero exit IS a failure, so a broken migration surfaces.
 */
export async function runExecHook(ctx: DeploymentContext, input: RunExecHookInput): Promise<void> {
	const deadline = Date.now() + (input.waitMs ?? 0);
	let containerId: string | null = null;
	do {
		for (const label of input.labels) {
			const out = await run(ctx.serverId, buildFindContainerCommand(label)).catch(() => "");
			const first = out
				.split("\n")
				.map((line) => line.trim())
				.find(Boolean);
			if (first) {
				containerId = first;
				break;
			}
		}
		if (containerId || Date.now() >= deadline) break;
		await new Promise((resolve) => setTimeout(resolve, CONVERGENCE_POLL_MS));
	} while (Date.now() < deadline);
	if (!containerId) {
		ctx.logger.line(
			`Warning: ${input.label.toLowerCase()} skipped — no running container found for ${input.appName}`,
		);
		return;
	}
	ctx.logger.line(`Running ${input.label.toLowerCase()}...`);
	try {
		await ctx.run(buildPostDeployCommand(containerId, input.command), {
			timeoutMs: hookTimeoutMs(),
		});
		ctx.logger.line(`${input.label} succeeded`);
	} catch (error) {
		throw describeHookFailure(input.label, error);
	}
}

/** Post-deploy hook of an application: exec into one converged swarm task. */
export function runPostDeployHook(
	ctx: DeploymentContext,
	input: { appName: string; command: string },
): Promise<void> {
	return runExecHook(ctx, {
		appName: input.appName,
		command: input.command,
		label: "Post-deploy command",
		labels: [swarmServiceLabel(input.appName)],
		waitMs: DEFAULT_HOOK_CONVERGENCE_MS,
	});
}

/**
 * Compose hooks. There is no image Nixploy built, so both run in a container
 * of the project: the pre hook against the one that is CURRENTLY running
 * (skipped on the first deploy, and aborting the job leaves it serving), the
 * post hook against the project that was just brought up.
 */
export function runComposeExecHook(
	ctx: DeploymentContext,
	input: { appName: string; command: string; label: string; waitMs?: number },
): Promise<void> {
	return runExecHook(ctx, {
		appName: input.appName,
		command: input.command,
		label: input.label,
		labels: [composeProjectLabel(input.appName), composeStackLabel(input.appName)],
		waitMs: input.waitMs,
	});
}
