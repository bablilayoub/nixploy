import { normalize } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	deployments,
	domains,
	previewDeployments,
	redirects,
	security,
} from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { redactSensitiveText } from "../../utils/public-url";
import { invalidateComposeContainers } from "../compose/containers";
import {
	buildComposeDeployCommand,
	prepareComposeFiles,
	resyncComposeDomains,
	runsOnPrimary,
} from "../compose/service";
import { invalidateDockerListings } from "../docker/containers";
import { buildPreviewComposeTarget } from "../preview/compose";
import { parsePreviewSourceRef } from "../preview/source-ref";
import { syncPreviewTraefik } from "../preview/traefik";
import { toTraefikDomainEntry, writeAppTraefikConfig } from "../traefik/config-writer";
import { buildImage } from "./builders";
import type { DeploymentContext } from "./context";
import { CommandError, spawnTargeted } from "./docker";
import { mergeEnv, parseEnv, resolveBuildEnv } from "./env";
import { type DeploymentStatus, deploymentEvents } from "./events";
import {
	DEFAULT_HOOK_CONVERGENCE_MS,
	runComposeExecHook,
	runPostDeployHook,
	runPreDeployHook,
} from "./hooks";
import { DeploymentLogger } from "./logger";
import { ensureEnvironmentNetwork } from "./network";
import { publishDeploymentStatusDetached } from "./notify";
import type { CommitInfo } from "./provenance";
import { pushBuiltImage, resolvePushRegistry } from "./push";
import {
	DeploymentCancelledError,
	getCancellationReason,
	onDeploymentCancelled,
	type QueueJob,
	registerDeploymentProcess,
	requestCancellation,
	setJobRunner,
	throwIfCancelled,
} from "./queue";
import { pinRollbackImage, recordRollback } from "./rollback";
import {
	type ApplicationRow,
	cloneGitSource,
	extractDropSource,
	pullDockerImage,
	readCheckoutCommit,
	resolveImageDigest,
	resolveRegistryAuth,
} from "./sources";
import { upsertSwarmService, waitForServiceConvergence } from "./swarm";

const log = createLogger("deploy-worker");

/** Per-job deadline default: `NIXPLOY_DEPLOY_TIMEOUT_MS` overrides it. */
export const DEFAULT_DEPLOY_TIMEOUT_MS = 60 * 60 * 1000;

/** Wall-clock budget of one deployment from the moment the worker picks it up. */
export function deployTimeoutMs(): number {
	const fromEnv = Number.parseInt(process.env.NIXPLOY_DEPLOY_TIMEOUT_MS ?? "", 10);
	return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_DEPLOY_TIMEOUT_MS;
}

/** "60 minutes" / "30 seconds" for the deadline error message. */
export function describeDeadline(ms: number): string {
	return ms >= 60_000
		? `${Math.round(ms / 60_000)} minutes`
		: `${Math.max(1, Math.round(ms / 1000))} seconds`;
}

/** Runs between pipeline steps; throws once the job was cancelled or abandoned. */
type Checkpoint = () => void;

/* -------------------------------------------------------------------------- */
/*  Traefik                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Re-write the application's Traefik config after a successful deploy.
 * The YAML is always written on the Nixploy host (where Traefik runs) — the
 * writer ignores serverId; see `traefik/config-writer.ts`.
 */
async function syncApplicationTraefik(application: ApplicationRow): Promise<void> {
	const [appDomains, appRedirects, appSecurity] = await Promise.all([
		db.query.domains.findMany({
			where: eq(domains.applicationId, application.applicationId),
			with: { middlewares: true },
		}),
		db.query.redirects.findMany({
			where: eq(redirects.applicationId, application.applicationId),
		}),
		db.query.security.findMany({ where: eq(security.applicationId, application.applicationId) }),
	]);
	if (appDomains.length === 0) return;
	await writeAppTraefikConfig({
		appName: application.appName,
		domains: appDomains
			.filter((domain) => domain.domainType !== "preview" && !domain.previewDeploymentId)
			// The mapper carries every routing column (middlewares, protocol,
			// entrypoint, tlsMode); a literal here used to drop new ones and a
			// deploy then quietly rewrote the YAML without them.
			.map(toTraefikDomainEntry),
		redirects: appRedirects.map((redirect) => ({
			regex: redirect.regex,
			replacement: redirect.replacement,
			permanent: redirect.permanent,
		})),
		basicAuth: appSecurity.map((entry) => ({
			username: entry.username,
			password: entry.password,
		})),
	});
}

/* -------------------------------------------------------------------------- */
/*  Application pipeline                                                      */
/* -------------------------------------------------------------------------- */

/** Resolve `buildPath` inside the checkout, rejecting escapes. */
const resolveBuildDir = (codeDir: string, buildPath: string): string => {
	// Strip trailing slashes first: normalize keeps them, and "/a/b/" would
	// break downstream containment checks that compare against base + "/".
	const cleanCodeDir = codeDir.replace(/[/\\]+$/, "");
	const resolved = normalize(`${cleanCodeDir}/${buildPath}`);
	if (resolved !== cleanCodeDir && !resolved.startsWith(`${cleanCodeDir}/`)) {
		throw new Error(`buildPath escapes the code directory: ${buildPath}`);
	}
	return resolved;
};

/**
 * Fill the row's commit fields from the checkout (or image digest) unless
 * the caller already knew them (webhook payloads carry sha/message/author).
 * `coalesce` keeps the richer webhook data; a failed write never fails the
 * deploy.
 */
async function recordProvenance(deploymentId: string, commit: CommitInfo): Promise<void> {
	await db
		.update(deployments)
		.set({
			commitSha: sql`coalesce(${deployments.commitSha}, ${commit.sha})`,
			commitMessage: sql`coalesce(${deployments.commitMessage}, ${commit.message})`,
			commitAuthor: sql`coalesce(${deployments.commitAuthor}, ${commit.author})`,
		})
		.where(eq(deployments.deploymentId, deploymentId))
		.catch((error: unknown) => {
			log.error(`Failed to record provenance for deployment ${deploymentId}`, {
				error: errorText(error),
			});
		});
}

type PreviewRow = typeof previewDeployments.$inferSelect;

/**
 * The row the source/build steps see for a preview job: the parent's config
 * under the preview's appName, pointed at the PR's source. Fork PRs fetch
 * the provider's PR head ref from the base repo, or (Bitbucket) clone the
 * head repository itself — see `preview/source-ref.ts`.
 *
 * `previewEnv` is folded into the service-level `env` layer, so the inherited
 * project → environment values still apply and the preview-only keys win
 * (product audit, Previews row). Everything downstream — the swarm spec's
 * `mergeEnv`, the deploy hooks — reads the target row, so nothing else has to
 * know previews exist.
 */
export function buildPreviewDeployTarget(
	application: ApplicationRow,
	preview: Pick<PreviewRow, "appName" | "branch">,
): ApplicationRow {
	const env = application.previewEnv
		? mergeEnv(application.env, application.previewEnv)
		: application.env;
	const source = parsePreviewSourceRef(preview.branch);
	if (!source) {
		return { ...application, appName: preview.appName, env };
	}
	if (source.kind === "fork") {
		return {
			...application,
			appName: preview.appName,
			env,
			owner: source.owner,
			repository: source.repository,
			branch: source.branch,
			gitBranch: source.branch,
		};
	}
	const ref = source.kind === "ref" ? source.ref : source.branch;
	return { ...application, appName: preview.appName, env, branch: ref, gitBranch: ref };
}

/**
 * Point a deploy at a one-off ref (branch, tag or sha) without touching the
 * service's configured branch. `cloneGitSource` reads `branch`, so overriding
 * that pair is all it takes — the same trick `buildPreviewDeployTarget` uses.
 * Docker-image sources have no checkout, so the ref is ignored there (the
 * router refuses it, this is the belt-and-braces half).
 */
export function buildRefDeployTarget(
	application: ApplicationRow,
	requestedRef: string | undefined,
): ApplicationRow {
	if (!requestedRef || application.sourceType === "docker") return application;
	return { ...application, branch: requestedRef, gitBranch: requestedRef };
}

async function runApplicationJob(
	ctx: DeploymentContext,
	job: QueueJob,
	checkpoint: Checkpoint,
): Promise<void> {
	const application = await db.query.applications.findFirst({
		where: eq(applications.applicationId, job.applicationId ?? ""),
		with: { environment: { with: { project: true } } },
	});
	if (!application) {
		throw new Error(`Application not found: ${job.applicationId}`);
	}

	const preview = job.previewDeploymentId
		? await db.query.previewDeployments.findFirst({
				where: eq(previewDeployments.previewDeploymentId, job.previewDeploymentId),
			})
		: null;
	if (job.previewDeploymentId && !preview) {
		throw new Error(`Preview deployment not found: ${job.previewDeploymentId}`);
	}
	if (preview && preview.applicationId !== application.applicationId) {
		throw new Error("Preview deployment does not belong to this application");
	}

	// Preview deploys an isolated Swarm service under preview.appName and
	// builds the PR source — never mutate the production service.
	// A one-off ref deploy (`nixploy app deploy --ref v1.2.0`, "Redeploy this
	// commit") overrides the checkout the same way, and only for this job: the
	// stored `branch` is untouched, so the next webhook push still builds the
	// configured branch. Previews win — their ref comes from the preview row.
	const deployTarget: ApplicationRow = preview
		? buildPreviewDeployTarget(application, preview)
		: buildRefDeployTarget(application, job.requestedRef);

	// Register every secret that could leak into command output: the fully
	// merged env (project → environment → application), not just the app's own.
	// The logger applies a redaction floor (short/numeric values are skipped).
	// `deployTarget.env` already carries `previewEnv` for preview jobs.
	const mergedEnv = mergeEnv(
		application.environment.project.env,
		application.environment.env,
		deployTarget.env,
	);
	for (const [, value] of parseEnv(mergedEnv)) ctx.logger.addSecret(value);
	for (const [, value] of parseEnv(application.buildArgs)) ctx.logger.addSecret(value);
	const registryAuth =
		application.sourceType === "docker" ? await resolveRegistryAuth(application) : null;
	if (registryAuth) ctx.logger.addSecret(registryAuth.password);

	let imageTag: string;
	if (application.sourceType === "docker") {
		ctx.logger.line("Using docker image source");
		imageTag = await pullDockerImage(ctx, application);
		// No commit to record: pin the registry digest so the history says
		// which `nginx:latest` this deployment actually ran.
		const digest = await resolveImageDigest(ctx, imageTag);
		if (digest) {
			await recordProvenance(job.deploymentId, {
				sha: digest,
				message: imageTag,
				author: null,
			});
		}
	} else {
		const codeDir =
			application.sourceType === "drop"
				? await extractDropSource(ctx, deployTarget)
				: await cloneGitSource(ctx, deployTarget);
		checkpoint();
		if (application.sourceType !== "drop") {
			const commit = await readCheckoutCommit(ctx, codeDir);
			if (commit) {
				ctx.logger.line(
					`Commit ${commit.sha.slice(0, 12)}${commit.author ? ` by ${commit.author}` : ""}${commit.message ? `: ${commit.message}` : ""}`,
				);
				await recordProvenance(job.deploymentId, commit);
			}
		}

		const buildDir = resolveBuildDir(codeDir, application.buildPath || "/");
		imageTag = await buildImage({
			ctx,
			application: deployTarget,
			buildDir,
			// Build args only (product audit, Env #2): the merged runtime env
			// used to be baked into nixpacks/railpack/pack images and their
			// cache. `NIXPLOY_BUILD_WITH_RUNTIME_ENV=1` restores that.
			env: resolveBuildEnv(application.buildArgs, mergedEnv),
		});
	}
	checkpoint();

	// Pre-deploy hook (migrations): a throwaway container from the image this
	// job produced, on the service's own overlay, BEFORE the rollout — so a
	// non-zero exit aborts here and the previous version keeps serving.
	// Previews are excluded on purpose: a PR's migration must never run
	// against the environment the production service shares.
	const preDeployCommand = application.preDeployCommand?.trim();
	if (!preview && preDeployCommand) {
		const network = await ensureEnvironmentNetwork(application.environment);
		await runPreDeployHook(ctx, {
			appName: application.appName,
			deploymentId: job.deploymentId,
			image: imageTag,
			network,
			env: mergedEnv,
			command: preDeployCommand,
		});
		checkpoint();
	}

	// Registry push: the built tag only exists on the node that built it, so
	// a replica scheduled anywhere else cannot pull it. Docker-source apps
	// already run a registry reference and previews are throwaway.
	let pushedRef: string | null = null;
	if (!preview && application.sourceType !== "docker" && application.pushRegistryId) {
		const pushRegistry = await resolvePushRegistry(application.pushRegistryId);
		if (pushRegistry) {
			pushedRef = await pushBuiltImage(ctx, {
				appName: application.appName,
				deploymentId: job.deploymentId,
				localTag: imageTag,
				registryRow: pushRegistry,
			});
		}
		checkpoint();
	}

	await upsertSwarmService(ctx, deployTarget, pushedRef ?? imageTag, {
		preview: Boolean(preview),
	});
	checkpoint();

	// `done` means the new version serves: wait for one running task (Swarm
	// reports `running` only after the image's HEALTHCHECK passed). A rollout
	// whose tasks keep failing fails the deployment with the engine's reason;
	// with start-first updates the previous version keeps serving meanwhile.
	ctx.logger.line("Waiting for the service to start...");
	await waitForServiceConvergence(deployTarget.appName, {
		log: (line) => ctx.logger.line(line),
	});
	checkpoint();
	ctx.logger.line("Service is running");

	if (preview) {
		// Route (parent's container port) + parent's basic-auth/redirects.
		await syncPreviewTraefik(preview.previewDeploymentId).catch((error) => {
			ctx.logger.line(
				`Warning: failed to sync preview Traefik config: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
		await db
			.update(previewDeployments)
			.set({ previewStatus: "done" })
			.where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId));
	} else {
		// Post-deploy hook: exec into one task of the rollout we just made,
		// waiting out the swarm's convergence first. A failure here IS a
		// deploy failure — the new version is serving, but broken.
		const postDeployCommand = application.postDeployCommand?.trim();
		if (postDeployCommand) {
			await runPostDeployHook(ctx, {
				appName: application.appName,
				command: postDeployCommand,
			});
			checkpoint();
		}

		// Traefik routing — best effort, the domain router re-syncs anyway.
		await syncApplicationTraefik(application).catch((error) => {
			ctx.logger.line(
				`Warning: failed to sync Traefik config: ${error instanceof Error ? error.message : String(error)}`,
			);
		});

		// Pin the running image as a rollback target (best effort: a failed
		// pin must not fail a deployment that is already serving traffic).
		try {
			const pinned = await pinRollbackImage(ctx, application, job.deploymentId, imageTag, {
				pushedRef,
			});
			await recordRollback({
				applicationId: application.applicationId,
				appName: application.appName,
				deploymentId: job.deploymentId,
				image: pinned,
				serverId: ctx.serverId,
				fullContext: {
					sourceType: application.sourceType,
					branch: application.branch ?? application.gitBranch ?? null,
					dockerImage: application.dockerImage ?? null,
				},
			});
			ctx.logger.line(`Rollback target pinned: ${pinned}`);
		} catch (error) {
			ctx.logger.line(
				`Warning: could not pin rollback image: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	ctx.logger.line("Deployment successful");
}

/* -------------------------------------------------------------------------- */
/*  Compose pipeline                                                          */
/* -------------------------------------------------------------------------- */

async function runComposeJob(
	ctx: DeploymentContext,
	job: QueueJob,
	checkpoint: Checkpoint,
): Promise<void> {
	const row = await db.query.compose.findFirst({
		where: eq(compose.composeId, job.composeId ?? ""),
	});
	if (!row) {
		throw new Error(`Compose service not found: ${job.composeId}`);
	}

	const preview = job.previewDeploymentId
		? await db.query.previewDeployments.findFirst({
				where: eq(previewDeployments.previewDeploymentId, job.previewDeploymentId),
			})
		: null;
	if (job.previewDeploymentId && !preview) {
		throw new Error(`Preview deployment not found: ${job.previewDeploymentId}`);
	}
	if (preview && preview.composeId !== row.composeId) {
		throw new Error("Preview deployment does not belong to this compose service");
	}

	// A preview renders and deploys an isolated project under
	// `<appName>-pr-<n>` (its own private network, volumes and Traefik keys)
	// from the pull request's source — never the production project.
	const target: typeof row = preview ? buildPreviewComposeTarget(row, preview) : row;

	for (const [, value] of parseEnv(target.env)) ctx.logger.addSecret(value);

	// Materialize compose file + merged env file (clones git sources too).
	ctx.logger.line("Preparing compose files...");
	// Snapshot the rendered file + env against THIS job (compose rollbacks).
	// Previews are throwaway and share the parent's composeId — snapshotting
	// one would offer a PR's file as a production rollback target.
	const files = await prepareComposeFiles(target, {
		deploymentId: preview ? null : job.deploymentId,
	});
	for (const secret of files.secrets) ctx.logger.addSecret(secret);
	checkpoint();

	// Pre-deploy hook. Compose has no image Nixploy built, so the command runs
	// inside a container of the project that is CURRENTLY running (skipped on
	// the first deploy). Aborting here leaves that project untouched.
	// Previews skip both hooks, like application previews do: a PR's migration
	// must never run against the environment production shares.
	const preDeployCommand = preview ? null : row.preDeployCommand?.trim();
	if (preDeployCommand) {
		await runComposeExecHook(ctx, {
			appName: row.appName,
			command: preDeployCommand,
			label: "Pre-deploy command",
		});
		checkpoint();
	}

	// The compose module owns the command line (stack vs compose, env
	// isolation, rendered file) — see modules/compose/commands.ts.
	const command = buildComposeDeployCommand(target, files);

	ctx.logger.line(
		target.composeType === "stack" ? "Deploying stack..." : "Starting compose project...",
	);
	// Stacks are Swarm services: `docker stack deploy` runs on the primary
	// manager with the file rendered there (tasks are pinned to the row's
	// server by the injected node constraint). Plain compose runs on the server.
	await ctx.run(command, { cwd: files.workDir, onPrimary: runsOnPrimary(target) });
	checkpoint();

	// The runtime tab's container list is cached for 10 s — a deploy replaces
	// every container, so drop it now instead of showing the old ids.
	invalidateComposeContainers(target.appName, target.serverId);

	// Post-deploy hook: the project is up, wait for a container and exec.
	const postDeployCommand = preview ? null : row.postDeployCommand?.trim();
	if (postDeployCommand) {
		await runComposeExecHook(ctx, {
			appName: row.appName,
			command: postDeployCommand,
			label: "Post-deploy command",
			waitMs: DEFAULT_HOOK_CONVERGENCE_MS,
		});
		checkpoint();
	}

	// Per-service Traefik configs — best effort. A preview writes its own
	// files (one per exposed service, under the preview project's key) and
	// must never rewrite production's.
	if (preview) {
		await syncPreviewTraefik(preview.previewDeploymentId).catch((error) => {
			ctx.logger.line(
				`Warning: failed to sync preview Traefik config: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
		await db
			.update(previewDeployments)
			.set({ previewStatus: "done" })
			.where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId));
	} else {
		await resyncComposeDomains(row.composeId).catch((error) => {
			ctx.logger.line(
				`Warning: failed to sync Traefik configs: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	}

	ctx.logger.line("Deployment successful");
}

/* -------------------------------------------------------------------------- */
/*  Runner                                                                    */
/* -------------------------------------------------------------------------- */

type TerminalStatus = Exclude<DeploymentStatus, "queued" | "running">;

async function setServiceStatus(
	job: QueueJob,
	status: "idle" | "running" | "done" | "error",
): Promise<void> {
	// Preview jobs carry the PARENT applicationId — never let a preview
	// deploy corrupt the production service's status.
	if (job.previewDeploymentId) return;
	if (job.applicationId) {
		await db
			.update(applications)
			.set({ status })
			.where(eq(applications.applicationId, job.applicationId));
	} else if (job.composeId) {
		await db.update(compose).set({ status }).where(eq(compose.composeId, job.composeId));
	}
}

/** Mirror a preview job's terminal outcome onto its previewDeployments row. */
async function setPreviewStatus(job: QueueJob, terminalStatus: TerminalStatus): Promise<void> {
	if (!job.previewDeploymentId) return;
	// "done" is already written by runApplicationJob on success.
	if (terminalStatus === "done") return;
	await db
		.update(previewDeployments)
		.set({ previewStatus: terminalStatus === "cancelled" ? "idle" : "error" })
		.where(eq(previewDeployments.previewDeploymentId, job.previewDeploymentId));
}

/**
 * Fan the outcome out to the org's notification channels (`appDeploy` on
 * success, `appBuildError` on failure — the per-channel toggles are applied
 * by `notifyEvent`). Cancellations are user actions and stay silent.
 */
async function notifyDeployOutcome(
	job: QueueJob,
	status: "done" | "error",
	errorMessage: string | null,
): Promise<void> {
	const { emitDeployNotification } = await import("../notifications");
	if (job.applicationId) {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, job.applicationId),
			columns: { name: true, appName: true, environmentId: true },
		});
		if (!application) return;
		const preview = job.previewDeploymentId
			? await db.query.previewDeployments.findFirst({
					where: eq(previewDeployments.previewDeploymentId, job.previewDeploymentId),
					columns: { appName: true, pullRequestNumber: true },
				})
			: null;
		await emitDeployNotification(
			preview
				? {
						name: `${application.name} (PR #${preview.pullRequestNumber ?? "?"} preview)`,
						appName: preview.appName,
						environmentId: application.environmentId,
					}
				: application,
			status,
			{ errorMessage, type: "application" },
		);
		return;
	}
	if (job.composeId) {
		const row = await db.query.compose.findFirst({
			where: eq(compose.composeId, job.composeId),
			columns: { name: true, appName: true, environmentId: true },
		});
		if (!row) return;
		const preview = job.previewDeploymentId
			? await db.query.previewDeployments.findFirst({
					where: eq(previewDeployments.previewDeploymentId, job.previewDeploymentId),
					columns: { appName: true, pullRequestNumber: true },
				})
			: null;
		await emitDeployNotification(
			preview
				? {
						name: `${row.name} (PR #${preview.pullRequestNumber ?? "?"} preview)`,
						appName: preview.appName,
						environmentId: row.environmentId,
					}
				: row,
			status,
			{ errorMessage, type: "compose" },
		);
	}
}

/** Incident + log ingestion + Deploy Copilot for a failed deployment. */
async function recordDeployFailure(job: QueueJob): Promise<void> {
	const { recordIncident, ingestServiceLog } = await import("../observability");
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, job.deploymentId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	const orgId =
		deployment?.application?.environment.project.organizationId ??
		deployment?.compose?.environment.project.organizationId;
	const projectId =
		deployment?.application?.environment.project.projectId ??
		deployment?.compose?.environment.project.projectId;
	const serviceName = deployment?.application?.name ?? deployment?.compose?.name ?? "service";
	const serviceId = job.applicationId ?? job.composeId ?? null;
	if (!orgId) return;
	await recordIncident({
		organizationId: orgId,
		projectId,
		kind: "deploy_failure",
		severity: "critical",
		title: `Deploy failed: ${serviceName}`,
		message: deployment?.errorMessage ?? "Deployment failed",
		serviceId,
		serviceName,
		// The kind is what turns `serviceId` into a page the panel can link to;
		// without it an incident names the service it cannot take you to.
		metadata: {
			deploymentId: job.deploymentId,
			serviceKind: job.applicationId ? "application" : "compose",
		},
	});
	if (deployment?.logPath) {
		const { readFile } = await import("node:fs/promises");
		const body = await readFile(deployment.logPath, "utf8").catch(() => "");
		if (body && serviceId) {
			await ingestServiceLog({
				organizationId: orgId,
				serviceId,
				serviceType: job.applicationId ? "application" : "compose",
				deploymentId: job.deploymentId,
				body,
			});
		}
	}
	const { maybeAutoExplainOnFailure } = await import("../ai");
	void maybeAutoExplainOnFailure(job.deploymentId, orgId).catch((aiError: unknown) => {
		log.error("Deploy Copilot auto-explain failed", { error: errorText(aiError) });
	});
}

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Execute one queued job end-to-end: source → build → swarm/compose →
 * status bookkeeping. Registered with the queue at module import time.
 *
 * Everything that can fail — including loading the row and opening the log
 * file — runs inside the try, so the deployment is ALWAYS finalized (row
 * status, service status, `finish` event). Before, an unwritable log dir or
 * a transient DB error left the row `running` forever, which also froze the
 * status reconciler for that service.
 *
 * Lifecycle: the queue's claim query already flipped the row from `queued` to
 * `running` (with `startedAt`) in one atomic statement, which is what makes
 * "claimed exactly once" true across restarts and concurrent claimers — the
 * worker only mirrors that onto the service row. The pipeline races a per-job deadline
 * ({@link deployTimeoutMs}) and the queue's cancellation signal, so a job
 * stuck in a step that is not process-bound (hung SSH handshake, Docker API
 * call, DB query) still finalizes; an abandoned pipeline dies at its next
 * `ctx.run` / checkpoint. Notifications and incident recording run detached
 * after `finish` so the queue slot is released without waiting on them.
 */
async function processJob(job: QueueJob): Promise<void> {
	let logger: DeploymentLogger | null = null;
	let terminalStatus: TerminalStatus = "done";
	let errorMessage: string | null = null;
	// Set once the job is confirmed live; an already-finalized row (cancelled
	// or superseded while queued) must not be re-finalized by the `finally`.
	let started = false;
	let deadline: NodeJS.Timeout | null = null;
	// Filled from inside the cancellation promise's executor (a closure, so a
	// plain `let` would be narrowed to `null` by the time `finally` runs).
	const teardown: Array<() => void> = [];
	// True once the runner gave up on the pipeline (cancel / deadline). The
	// queue clears its cancellation marker when this function returns, so the
	// pipeline needs its own flag to refuse further work.
	let abandoned = false;
	const checkpoint: Checkpoint = () => {
		if (abandoned) throw new DeploymentCancelledError(job.deploymentId);
		throwIfCancelled(job.deploymentId);
	};

	try {
		const deployment = await db.query.deployments.findFirst({
			where: eq(deployments.deploymentId, job.deploymentId),
		});
		if (!deployment) return;
		// The claim query set this; anything else means the row was finalized
		// underneath us (a stale in-process start) — do not re-finalize it.
		if (deployment.status !== "running") return;
		started = true;

		logger = new DeploymentLogger(deployment.logPath, job.deploymentId);
		const log = logger;
		const ctx: DeploymentContext = {
			serverId: job.serverId,
			logger: log,
			run: async (command, opts) => {
				checkpoint();
				const proc = await spawnTargeted(opts?.onPrimary ? null : job.serverId, command, {
					cwd: opts?.cwd,
					timeoutMs: opts?.timeoutMs,
					onData: (chunk) => log.write(chunk),
				});
				registerDeploymentProcess(job.deploymentId, proc);
				await proc.done;
			},
		};

		// The row is already `running` (claim query) — only the service row and
		// the log still need the transition.
		await setServiceStatus(job, "running");
		log.line(
			`Deployment ${job.deploymentId} started (${job.type}${job.serverId ? `, server ${job.serverId}` : ", local"})`,
		);

		const timeoutMs = deployTimeoutMs();
		deadline = setTimeout(() => {
			requestCancellation(job.deploymentId, "timeout");
		}, timeoutMs);
		deadline.unref();

		const cancellation = new Promise<never>((_, reject) => {
			teardown.push(
				onDeploymentCancelled(job.deploymentId, () => {
					reject(new DeploymentCancelledError(job.deploymentId));
				}),
			);
		});
		const pipeline = job.applicationId
			? runApplicationJob(ctx, job, checkpoint)
			: job.composeId
				? runComposeJob(ctx, job, checkpoint)
				: Promise.reject(
						new Error("Deployment job targets neither an application nor a compose service"),
					);
		// Whichever side loses the race must not surface as an unhandled rejection.
		void pipeline.catch(() => {});
		void cancellation.catch(() => {});
		await Promise.race([pipeline, cancellation]);
	} catch (error) {
		started = true;
		abandoned = true;
		const reason = getCancellationReason(job.deploymentId);
		const cancelled =
			reason !== null ||
			error instanceof DeploymentCancelledError ||
			(error instanceof CommandError && error.killed);
		const rawMessage = error instanceof Error ? error.message : String(error);
		const message = redactSensitiveText(rawMessage, logger?.listSecrets() ?? []);
		if (cancelled && (reason === null || reason === "user")) {
			terminalStatus = "cancelled";
			errorMessage = null;
		} else if (reason === "shutdown") {
			terminalStatus = "error";
			errorMessage = "Interrupted by panel shutdown";
		} else if (reason === "timeout") {
			terminalStatus = "error";
			errorMessage = `Deployment exceeded ${describeDeadline(deployTimeoutMs())}`;
		} else {
			terminalStatus = "error";
			errorMessage = message;
		}
		if (logger) {
			logger.line(
				terminalStatus === "cancelled"
					? "Deployment cancelled"
					: `Deployment failed: ${errorMessage}`,
			);
		} else {
			log.error(`Deployment ${job.deploymentId} failed before its log was opened`, {
				error: errorMessage ?? message,
			});
		}
	} finally {
		if (deadline) clearTimeout(deadline);
		for (const off of teardown) off();
		if (started) {
			// A user cancel that landed after the pipeline already finished is
			// still reported as cancelled (historic behaviour); deadline and
			// shutdown cancels that lost the race to a successful pipeline keep
			// the truthful "done".
			if (terminalStatus === "done" && getCancellationReason(job.deploymentId) === "user") {
				terminalStatus = "cancelled";
			}
			abandoned = true;
			await db
				.update(deployments)
				.set({ status: terminalStatus, errorMessage, finishedAt: new Date() })
				.where(eq(deployments.deploymentId, job.deploymentId))
				.catch((dbError: unknown) => {
					log.error(`Failed to finalize deployment ${job.deploymentId}`, {
						error: errorText(dbError),
					});
				});
			// Without this, failed previews stayed "running" forever.
			await setPreviewStatus(job, terminalStatus).catch(() => {});
			await setServiceStatus(
				job,
				terminalStatus === "done" ? "running" : terminalStatus === "cancelled" ? "idle" : "error",
			).catch(() => {});
			logger?.close();
			// What runs on that server just changed: drop its cached `docker ps`
			// / `service ls` listings so the Docker tab's next read is truthful
			// instead of up to 10 s stale (architecture audit #14).
			invalidateDockerListings(job.serverId);
			deploymentEvents.emit("finish", { deploymentId: job.deploymentId, status: terminalStatus });
			// Cross-process: in the split this is what closes the panel's
			// `/ws/deployment` stream and updates every open dashboard.
			publishDeploymentStatusDetached(job.deploymentId, terminalStatus);

			// Detached on purpose: the queue slot frees as soon as this returns
			// (architecture audit #16 — a slow notification channel used to add
			// up to 10 s of dead time between deploys).
			if (terminalStatus !== "cancelled") {
				void notifyDeployOutcome(job, terminalStatus, errorMessage).catch(
					(notifyError: unknown) => {
						log.error("Failed to send deploy notification", { error: errorText(notifyError) });
					},
				);
			}
			if (terminalStatus === "error") {
				void recordDeployFailure(job).catch((obsError: unknown) => {
					log.error("Failed to record deploy observability", { error: errorText(obsError) });
				});
			}
		}
	}
}

setJobRunner(processJob);
