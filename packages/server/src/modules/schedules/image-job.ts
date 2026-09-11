import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { writeFileTargeted } from "../deployment/docker";
import { hardeningFlags, hookTimeoutMs } from "../deployment/hooks";
import { ensureEnvironmentNetworkById } from "../deployment/network";
import { getAppBasePath, shellQuote } from "../deployment/paths";
import { badRequest, preconditionFailed } from "../errors";
import { mergeEnv, parseEnv, resolveEnvironmentVariables, toEnvString } from "../projects";
import { assertValidImageRef } from "../updates/registry";

/**
 * Job / cron services (product audit, Platform row "No standalone job/cron
 * service").
 *
 * An `exec` schedule needs a RUNNING container to exec into, so a stopped
 * application cannot host a nightly job and a job has to be modelled as a
 * long-running service that mostly sleeps. An `image` schedule runs the
 * command in a throwaway container instead:
 *
 *   docker run --rm --name … --network <env overlay> --env-file <0600 file>
 *     <hardening baseline> --entrypoint sh <image> -c '<command>'
 *
 * Everything load-bearing is borrowed from the deploy-hook path
 * (`deployment/hooks.ts`), which solved the same problems already:
 *
 * - `--entrypoint sh` — without it the image's own ENTRYPOINT receives
 *   `sh -c '<command>'` as ARGUMENTS and ignores them (exit 127 means the
 *   image has no `/bin/sh` at all: scratch/distroless cannot run a job).
 * - `--env-file` written 0600 on the target host — a tenant's secrets never
 *   reach argv, where `ps` shows them.
 * - the container hardening baseline (`CapabilityDrop ALL` + the standard
 *   adds, `no-new-privileges`, a pids ceiling).
 * - the environment overlay, so the job can reach its own database.
 */

/** Job deadline default: `NIXPLOY_SCHEDULE_TIMEOUT_MS` overrides it, else the hook budget. */
export function scheduleTimeoutMs(): number {
	const fromEnv = Number.parseInt(process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS ?? "", 10);
	return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : hookTimeoutMs();
}

export interface ImageJobCommandInput {
	image: string;
	/** Overlay the container joins; omitted when the environment has none yet. */
	network: string | null;
	/** Absolute path of the 0600 env file on the target host. */
	envFilePath: string;
	containerName: string;
	shellType: "bash" | "sh";
	command: string;
}

/**
 * Exact `docker run` line for an image job. Pure — every value the tenant
 * controls is shell-quoted, and the command itself is the single `-c`
 * argument of the shell, never spliced into the docker line.
 */
export function buildImageJobCommand(input: ImageJobCommandInput): string {
	return [
		"docker run --rm",
		`--name ${shellQuote(input.containerName)}`,
		...(input.network ? [`--network ${shellQuote(input.network)}`] : []),
		`--env-file ${shellQuote(input.envFilePath)}`,
		hardeningFlags(),
		// The entrypoint is always `sh`: `bash` may not exist in the image, and
		// the shell the operator picked is applied INSIDE it when they want one.
		"--entrypoint sh",
		shellQuote(input.image),
		`-c ${shellQuote(wrapInShell(input.shellType, input.command))}`,
	].join(" ");
}

/**
 * `bash` schedules re-enter bash from `sh` when the image has one, and fall
 * back to `sh` when it does not — an image job must not fail with "bash: not
 * found" just because the row's default shell is bash.
 */
function wrapInShell(shellType: "bash" | "sh", command: string): string {
	if (shellType !== "bash") return command;
	return `if command -v bash >/dev/null 2>&1; then exec bash -c ${shellQuote(command)}; else ${command}; fi`;
}

/** `<config>/applications/<name>/job-<id>.env` — 0600, removed after the run. */
export const jobEnvFilePath = (slug: string, runId: string): string =>
	`${getAppBasePath(slug)}/job-${runId}.env`;

/** `<slug>-job-<short id>` — docker container names allow `[a-zA-Z0-9_.-]`. */
export function jobContainerName(slug: string, runId: string): string {
	const short = runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "job";
	const safe = slug.replace(/[^a-zA-Z0-9_.-]/g, "-") || "job";
	return `${safe}-job-${short}`.slice(0, 60);
}

export interface ImageJobTarget {
	/** Image the job runs; validated with the registry's own ref parser. */
	image?: string | null;
	shellType: "bash" | "sh";
	command: string;
	script?: string | null;
	applicationId?: string | null;
	composeId?: string | null;
	/** Only used for the container name and the env-file directory. */
	appName?: string | null;
}

interface ResolvedJobContext {
	slug: string;
	serverId: string | null;
	environmentId: string | null;
	serviceEnv: string | null;
}

/**
 * Where the job runs and with what env. Prefers the service ids over a stored
 * `appName`, exactly like `runner.ts#resolveAppName` — a stale or tampered
 * name must never retarget a run.
 */
async function resolveJobContext(target: ImageJobTarget): Promise<ResolvedJobContext> {
	if (target.applicationId) {
		const app = await db.query.applications.findFirst({
			where: eq(applications.applicationId, target.applicationId),
		});
		if (app) {
			return {
				slug: app.appName,
				serverId: app.serverId,
				environmentId: app.environmentId,
				serviceEnv: app.env,
			};
		}
	}
	if (target.composeId) {
		const stack = await db.query.compose.findFirst({
			where: eq(compose.composeId, target.composeId),
		});
		if (stack) {
			return {
				slug: stack.appName,
				serverId: stack.serverId,
				environmentId: stack.environmentId,
				serviceEnv: stack.env,
			};
		}
	}
	if (target.appName) {
		return { slug: target.appName, serverId: null, environmentId: null, serviceEnv: null };
	}
	throw preconditionFailed(
		"Image schedule has no target service — attach it to an application or compose stack",
	);
}

/**
 * Merged env an image job sees: organization → project → environment →
 * service, exactly the inheritance a deployment of that service resolves.
 */
async function resolveJobEnv(context: ResolvedJobContext): Promise<string> {
	const inherited = context.environmentId
		? await resolveEnvironmentVariables(context.environmentId).catch(() => ({}))
		: {};
	return toEnvString(mergeEnv(inherited, parseEnv(context.serviceEnv)));
}

/** Reject an image ref before it reaches a shell (`exec` runs through `sh -c`). */
export function assertJobImage(image: string | null | undefined): string {
	if (!image?.trim()) {
		throw badRequest("An image schedule needs an image (for example alpine:3.20)");
	}
	try {
		return assertValidImageRef(image.trim()).canonical;
	} catch (error) {
		throw badRequest(error instanceof Error ? error.message : "Invalid image reference");
	}
}

const run = (serverId: string | null, command: string, timeout: number): Promise<string> =>
	serverId
		? execAsyncRemote(serverId, command, { timeoutMs: timeout })
		: execAsync(command, { timeout });

/**
 * Run one image job and resolve with its combined output. Rejects with the
 * underlying exec error so the schedule records a failure, and always cleans
 * up the env file and a container that outlived its deadline.
 */
export async function runImageJob(target: ImageJobTarget): Promise<string> {
	const image = assertJobImage(target.image);
	const context = await resolveJobContext(target);
	const runId = randomUUID();
	const envFilePath = jobEnvFilePath(context.slug, runId);
	const containerName = jobContainerName(context.slug, runId);
	// ENSURE, not just resolve: the overlay is created by the deploy path, and a
	// job may well be the first thing that ever runs in this environment (that
	// is the point — a stopped service can still host a job). A host where the
	// overlay cannot be created runs the job without one rather than failing.
	const network = context.environmentId
		? await ensureEnvironmentNetworkById(context.environmentId).catch(() => null)
		: null;
	const env = await resolveJobEnv(context);
	const timeout = scheduleTimeoutMs();

	// Secrets reach the container through a 0600 file on the target host,
	// never through argv (`ps`) or the docker CLI's own environment.
	await writeFileTargeted(context.serverId, envFilePath, `${env}\n`, "600");
	try {
		return await run(
			context.serverId,
			buildImageJobCommand({
				image,
				network,
				envFilePath,
				containerName,
				shellType: target.shellType,
				// An inline script replaces the command, same as `exec` schedules.
				command: target.script?.trim() ? target.script : target.command,
			}),
			timeout,
		);
	} finally {
		await run(
			context.serverId,
			`docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true; rm -f ${shellQuote(envFilePath)}`,
			30_000,
		).catch(() => {
			// Best effort: `--rm` already removes the container on a clean exit.
		});
	}
}
