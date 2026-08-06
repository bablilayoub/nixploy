import { normalize } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, domains, redirects, security } from "../../db/schema";
import { shellQuote as composeShellQuote } from "../compose/paths";
import { prepareComposeFiles, resyncComposeDomains } from "../compose/service";
import { buildImage } from "./builders";
import type { DeploymentContext } from "./context";
import { CommandError, spawnTargeted } from "./docker";
import { mergeEnv, parseEnv } from "./env";
import { type DeploymentStatus, deploymentEvents } from "./events";
import { DeploymentLogger } from "./logger";
import {
	DeploymentCancelledError,
	isDeploymentCancelled,
	type QueueJob,
	registerDeploymentProcess,
	setJobRunner,
	throwIfCancelled,
} from "./queue";
import {
	type ApplicationRow,
	cloneGitSource,
	extractDropSource,
	pullDockerImage,
	resolveRegistryAuth,
} from "./sources";
import { upsertSwarmService } from "./swarm";

/* -------------------------------------------------------------------------- */
/*  Traefik adapter (sibling module may land after this one mid-flight)       */
/* -------------------------------------------------------------------------- */

interface TraefikModule {
	writeAppTraefikConfig(input: {
		appName: string;
		serverId?: string | null;
		domains: Array<{
			host: string;
			port: number;
			path?: string | null;
			https: boolean;
			certificateType: "letsencrypt" | "none" | "custom";
			certificateId?: string | null;
		}>;
		redirects?: Array<{ regex: string; replacement: string; permanent: boolean }>;
		basicAuth?: Array<{ username: string; password: string }>;
	}): Promise<void>;
}

async function getTraefik(): Promise<TraefikModule | null> {
	try {
		// Resolved dynamically so this module runs whether or not the sibling
		// Traefik writer has landed yet (it is built in parallel).
		const mod = (await import("../traefik/index")) as Partial<TraefikModule>;
		return typeof mod?.writeAppTraefikConfig === "function" ? (mod as TraefikModule) : null;
	} catch {
		return null;
	}
}

/** Re-write the application's Traefik config after a successful deploy. */
async function syncApplicationTraefik(application: ApplicationRow): Promise<void> {
	const traefik = await getTraefik();
	if (!traefik) return;
	const [appDomains, appRedirects, appSecurity] = await Promise.all([
		db.query.domains.findMany({ where: eq(domains.applicationId, application.applicationId) }),
		db.query.redirects.findMany({
			where: eq(redirects.applicationId, application.applicationId),
		}),
		db.query.security.findMany({ where: eq(security.applicationId, application.applicationId) }),
	]);
	if (appDomains.length === 0) return;
	await traefik.writeAppTraefikConfig({
		appName: application.appName,
		serverId: application.serverId,
		domains: appDomains.map((domain) => ({
			host: domain.host,
			port: domain.port ?? 80,
			path: domain.path,
			https: domain.https,
			certificateType: domain.certificateType,
			certificateId: domain.certificateId,
		})),
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

async function runApplicationJob(ctx: DeploymentContext, job: QueueJob): Promise<void> {
	const application = await db.query.applications.findFirst({
		where: eq(applications.applicationId, job.applicationId ?? ""),
		with: { environment: { with: { project: true } } },
	});
	if (!application) {
		throw new Error(`Application not found: ${job.applicationId}`);
	}

	// Register every secret that could leak into command output.
	for (const [, value] of parseEnv(application.env)) ctx.logger.addSecret(value);
	const registryAuth =
		application.sourceType === "docker" ? await resolveRegistryAuth(application) : null;
	if (registryAuth) ctx.logger.addSecret(registryAuth.password);

	let imageTag: string;
	if (application.sourceType === "docker") {
		ctx.logger.line("Using docker image source");
		imageTag = await pullDockerImage(ctx, application);
	} else {
		const codeDir =
			application.sourceType === "drop"
				? await extractDropSource(ctx, application)
				: await cloneGitSource(ctx, application);
		throwIfCancelled(job.deploymentId);

		const buildDir = resolveBuildDir(codeDir, application.buildPath || "/");
		const mergedEnv = mergeEnv(
			application.environment.project.env,
			application.environment.env,
			application.env,
		);
		imageTag = await buildImage({
			ctx,
			application,
			buildDir,
			env: parseEnv(mergedEnv).map(([k, v]) => `${k}=${v}`),
		});
	}
	throwIfCancelled(job.deploymentId);

	await upsertSwarmService(ctx, application, imageTag);
	throwIfCancelled(job.deploymentId);

	// Traefik routing — best effort, the domain router re-syncs anyway.
	await syncApplicationTraefik(application).catch((error) => {
		ctx.logger.line(
			`Warning: failed to sync Traefik config: ${error instanceof Error ? error.message : String(error)}`,
		);
	});

	ctx.logger.line("Deployment successful");
}

/* -------------------------------------------------------------------------- */
/*  Compose pipeline                                                          */
/* -------------------------------------------------------------------------- */

async function runComposeJob(ctx: DeploymentContext, job: QueueJob): Promise<void> {
	const row = await db.query.compose.findFirst({
		where: eq(compose.composeId, job.composeId ?? ""),
	});
	if (!row) {
		throw new Error(`Compose service not found: ${job.composeId}`);
	}

	for (const [, value] of parseEnv(row.env)) ctx.logger.addSecret(value);

	// Materialize compose file + merged env file (clones git sources too).
	ctx.logger.line("Preparing compose files...");
	const files = await prepareComposeFiles(row);
	throwIfCancelled(job.deploymentId);

	const f = composeShellQuote(files.composeFilePath);
	const env = composeShellQuote(files.envFilePath);
	const command =
		row.composeType === "stack"
			? // `docker stack deploy` has no --env-file; render the interpolated
				// file with `docker compose config` and feed it via stdin instead.
				`docker compose -f ${f} --env-file ${env} config | docker stack deploy --with-registry-auth --prune -c - ${composeShellQuote(row.appName)}`
			: `docker compose -p ${composeShellQuote(row.appName)} -f ${f} --env-file ${env} up -d --remove-orphans`;

	ctx.logger.line(
		row.composeType === "stack" ? "Deploying stack..." : "Starting compose project...",
	);
	await ctx.run(command, { cwd: files.workDir });
	throwIfCancelled(job.deploymentId);

	// Per-service Traefik configs for compose domains — best effort.
	await resyncComposeDomains(row.composeId).catch((error) => {
		ctx.logger.line(
			`Warning: failed to sync Traefik configs: ${error instanceof Error ? error.message : String(error)}`,
		);
	});

	ctx.logger.line("Deployment successful");
}

/* -------------------------------------------------------------------------- */
/*  Runner                                                                    */
/* -------------------------------------------------------------------------- */

type TerminalStatus = Exclude<DeploymentStatus, "running">;

async function setServiceStatus(
	job: QueueJob,
	status: "idle" | "running" | "done" | "error",
): Promise<void> {
	if (job.applicationId) {
		await db
			.update(applications)
			.set({ status })
			.where(eq(applications.applicationId, job.applicationId));
	} else if (job.composeId) {
		await db.update(compose).set({ status }).where(eq(compose.composeId, job.composeId));
	}
}

/**
 * Execute one queued job end-to-end: source → build → swarm/compose →
 * status bookkeeping. Registered with the queue at module import time.
 */
async function processJob(job: QueueJob): Promise<void> {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, job.deploymentId),
	});
	if (!deployment) return;
	// Already finalized (e.g. cancelled while pending) — nothing to do.
	if (deployment.status !== "running") return;

	const logger = new DeploymentLogger(deployment.logPath);
	const ctx: DeploymentContext = {
		serverId: job.serverId,
		logger,
		run: async (command, opts) => {
			const proc = await spawnTargeted(job.serverId, command, {
				cwd: opts?.cwd,
				onData: (chunk) => logger.write(chunk),
			});
			registerDeploymentProcess(job.deploymentId, proc);
			await proc.done;
		},
	};

	let terminalStatus: TerminalStatus = "done";
	try {
		await db
			.update(deployments)
			.set({ startedAt: new Date() })
			.where(eq(deployments.deploymentId, job.deploymentId));
		await setServiceStatus(job, "running");
		logger.line(
			`Deployment ${job.deploymentId} started (${job.type}${job.serverId ? `, server ${job.serverId}` : ", local"})`,
		);

		if (job.applicationId) {
			await runApplicationJob(ctx, job);
		} else if (job.composeId) {
			await runComposeJob(ctx, job);
		} else {
			throw new Error("Deployment job targets neither an application nor a compose service");
		}
	} catch (error) {
		const cancelled =
			error instanceof DeploymentCancelledError ||
			isDeploymentCancelled(job.deploymentId) ||
			(error instanceof CommandError && error.killed);
		terminalStatus = cancelled ? "cancelled" : "error";
		const message = error instanceof Error ? error.message : String(error);
		logger.line(cancelled ? "Deployment cancelled" : `Deployment failed: ${message}`);
		await db
			.update(deployments)
			.set({ errorMessage: cancelled ? null : message })
			.where(eq(deployments.deploymentId, job.deploymentId));
	} finally {
		await db
			.update(deployments)
			.set({ status: terminalStatus, finishedAt: new Date() })
			.where(eq(deployments.deploymentId, job.deploymentId));
		await setServiceStatus(
			job,
			terminalStatus === "done" ? "done" : terminalStatus === "cancelled" ? "idle" : "error",
		).catch(() => {});
		logger.close();
		deploymentEvents.emit("finish", { deploymentId: job.deploymentId, status: terminalStatus });

		if (terminalStatus === "error") {
			try {
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
				if (orgId) {
					await recordIncident({
						organizationId: orgId,
						projectId,
						kind: "deploy_failure",
						severity: "critical",
						title: `Deploy failed: ${serviceName}`,
						message: deployment?.errorMessage ?? "Deployment failed",
						serviceId,
						serviceName,
						metadata: { deploymentId: job.deploymentId },
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
				}
			} catch (obsError) {
				console.error("Failed to record deploy observability:", obsError);
			}
		}
	}
}

setJobRunner(processJob);
