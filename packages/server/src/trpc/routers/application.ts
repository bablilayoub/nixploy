import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
	applications,
	deployments,
	environments,
	projects,
	registry,
	rollbacks,
} from "../../db/schema";
import { generateId } from "../../db/schema/utils";
import {
	assertApplicationAccess,
	assertEnvironmentAccess,
	createApplication,
	deleteApplication,
	duplicateApplication,
	getOrganizationId,
	inspectSwarmService,
	reloadApplication,
	saveEnvironment,
	startApplication,
	stopApplication,
	updateApplication,
	updateSwarmServiceImage,
	upsertApplicationSwarmService,
} from "../../modules/application";
import type { ApplicationWithTenancy } from "../../modules/application/org";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { redactServerCommandLog } from "../../modules/cluster";
import {
	applicationReadiness,
	cancelDeployment as cancelQueuedDeployment,
	provenanceForSession,
	queueDeployment,
	SOURCE_NOT_CONFIGURED,
} from "../../modules/deployment";
import { getDeploymentLogPath } from "../../modules/deployment/paths";
import { assertCapability, assertWithinQuota, hasCapability } from "../../modules/projects";
import { textBlobSchema, watchPathsSchema } from "../../utils/input-limits";
import { assertSafeGitCloneUrl } from "../../utils/public-url";
import {
	labelsSwarmSchema,
	modeSwarmSchema,
	networkSwarmSchema,
	privilegesSwarmSchema,
	relaxesContainerHardening,
	restartPolicySwarmSchema,
	rollbackConfigSwarmSchema,
	updateConfigSwarmSchema,
} from "../../utils/swarm-overrides";
import { appNameSchema, assertSafeDockerImageRef } from "../../utils/validators";
import {
	assertGitProviderInOrganization,
	assertServerInOrganization,
	assertSshKeyInOrganization,
} from "../assert-org-refs";
import { protectedProcedure, router } from "../init";
import { redactApplicationSecrets } from "../redact-secrets";

const applicationIdInput = z.object({ applicationId: z.string().min(1) });

/** Never ship Swarm join tokens via nested `server.command`. */
function publicApplicationServer<T>(application: T): T {
	const row = application as { server?: { command?: string | null } | null } & Record<
		string,
		unknown
	>;
	if (!row.server) return application;
	return {
		...row,
		server: {
			...row.server,
			command: redactServerCommandLog(row.server.command),
		},
	} as T;
}

/**
 * Overrides that weaken the platform's own isolation are instance-admin only.
 *
 * `networkSwarm` can only target the platform namespace (`nixploy-*`, see
 * `utils/swarm-overrides.ts`) — the environment overlay and the domain-derived
 * `nixploy-network` attachment are computed, not configurable — so every value
 * it accepts reaches infrastructure a tenant must not join. The same gate
 * covers a future `privilegesSwarm` column (`relaxesContainerHardening`).
 */
const assertHardeningOverrideAllowed = async (
	session: { user: { id: string; role?: string | null } },
	input: { networkSwarm?: unknown; privilegesSwarm?: unknown },
): Promise<void> => {
	const networks = input.networkSwarm;
	if (Array.isArray(networks) && networks.length > 0) {
		await assertInstanceAdmin(session);
		return;
	}
	const privileges = privilegesSwarmSchema.nullable().optional().safeParse(input.privilegesSwarm);
	if (privileges.success && relaxesContainerHardening(privileges.data)) {
		await assertInstanceAdmin(session);
	}
};

/** Fields that change the swarm service spec and trigger a re-upsert. */
const swarmSpecFields = {
	replicas: z.number().int().min(0).optional(),
	memoryReservation: z.string().nullable().optional(),
	memoryLimit: z.string().nullable().optional(),
	cpuReservation: z.string().nullable().optional(),
	cpuLimit: z.string().nullable().optional(),
	command: z.string().nullable().optional(),
	healthCheckSwarm: z.unknown().nullable().optional(),
	restartPolicySwarm: restartPolicySwarmSchema.nullable().optional(),
	placementSwarm: z.unknown().nullable().optional(),
	updateConfigSwarm: updateConfigSwarmSchema.nullable().optional(),
	rollbackConfigSwarm: rollbackConfigSwarmSchema.nullable().optional(),
	modeSwarm: modeSwarmSchema.nullable().optional(),
	labelsSwarm: labelsSwarmSchema.nullable().optional(),
	networkSwarm: networkSwarmSchema.nullable().optional(),
	privilegesSwarm: privilegesSwarmSchema.nullable().optional(),
} as const;

/** Verify a git provider connection (github/gitlab/bitbucket/gitea row) belongs to the org. */
const assertGitProviderAccess = assertGitProviderInOrganization;

/**
 * Pre-flight (UX audit F2): a brand-new app with no repository or image used
 * to queue fine, fail 15 ms later in the worker and leave a red "Error" with
 * no reason. Refuse before a row exists, with the message the UI also shows
 * on the disabled Deploy button (`application.one.readiness`).
 */
const assertDeployable = async (application: ApplicationWithTenancy): Promise<void> => {
	const readiness = await applicationReadiness(application);
	if (!readiness.canDeploy) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: readiness.reason ?? SOURCE_NOT_CONFIGURED,
		});
	}
};

/** Rollbacks skip the deploy worker, so their (short) log is written here. */
const writeRollbackLog = async (logPath: string, lines: string[]): Promise<void> => {
	try {
		await mkdir(dirname(logPath), { recursive: true });
		await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
	} catch (error) {
		console.error(`Failed to write rollback log ${logPath}:`, error);
	}
};

export const applicationRouter = router({
	/** All applications of a project (optionally one environment). */
	all: protectedProcedure
		.input(z.object({ projectId: z.string().min(1), environmentName: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const project = await db.query.projects.findFirst({
				where: eq(projects.projectId, input.projectId),
			});
			if (!project || project.organizationId !== organizationId) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
			}
			const envs = await db.query.environments.findMany({
				where: input.environmentName
					? and(
							eq(environments.projectId, input.projectId),
							eq(environments.name, input.environmentName),
						)
					: eq(environments.projectId, input.projectId),
			});
			if (envs.length === 0) return [];
			const rows = await db.query.applications.findMany({
				where: inArray(
					applications.environmentId,
					envs.map((environment) => environment.environmentId),
				),
				orderBy: desc(applications.createdAt),
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			if (canSeeSecrets) return rows.map(publicApplicationServer);
			return rows.map((row) => publicApplicationServer(redactApplicationSecrets(row)));
		}),

	one: protectedProcedure.input(applicationIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		// Related credential rows are narrowed to identifying columns: loading
		// them whole would decrypt registry passwords, provider tokens and the
		// deploy SSH private key straight into the response.
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, input.applicationId),
			with: {
				environment: { with: { project: true } },
				registry: {
					columns: {
						registryId: true,
						registryName: true,
						registryUrl: true,
						registryType: true,
						imagePrefix: true,
						username: true,
					},
				},
				github: { columns: { githubId: true, githubAppName: true } },
				gitlab: { columns: { gitlabId: true, gitlabUrl: true, groupName: true } },
				bitbucket: {
					columns: {
						bitbucketId: true,
						bitbucketUsername: true,
						bitbucketWorkspaceName: true,
					},
				},
				gitea: { columns: { giteaId: true, giteaUrl: true } },
				customGitSSHKey: { columns: { sshKeyId: true, name: true, publicKey: true } },
				server: true,
			},
		});
		if (!application || application.environment.project.organizationId !== organizationId) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
		}
		const [canSeeSecrets, readiness] = await Promise.all([
			hasCapability(ctx.session.user.id, organizationId, "secrets.read"),
			applicationReadiness(application),
		]);
		// `readiness` is the same predicate `deploy` enforces, so the UI can
		// disable Deploy with the reason instead of learning it from a toast.
		const safe = { ...publicApplicationServer(application), readiness };
		if (canSeeSecrets) return safe;
		return redactApplicationSecrets(safe);
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				description: z.string().optional(),
				appName: appNameSchema.optional(),
				projectId: z.string().min(1),
				environmentId: z.string().optional(),
				environmentName: z.string().optional(),
				serverId: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.create");
			await assertWithinQuota(organizationId, { services: true });

			let environmentId = input.environmentId;
			if (environmentId) {
				await assertEnvironmentAccess(environmentId, organizationId);
			} else {
				const project = await db.query.projects.findFirst({
					where: eq(projects.projectId, input.projectId),
				});
				if (!project || project.organizationId !== organizationId) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
				}
				const environmentName = input.environmentName ?? "default";
				let environment = await db.query.environments.findFirst({
					where: and(
						eq(environments.projectId, project.projectId),
						eq(environments.name, environmentName),
					),
				});
				if (!environment) {
					await assertCapability(ctx.session.user.id, organizationId, "project.write");
					const [created] = await db
						.insert(environments)
						.values({ name: environmentName, projectId: project.projectId })
						.returning();
					environment = created;
				}
				if (!environment) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to resolve environment",
					});
				}
				environmentId = environment.environmentId;
			}

			await assertServerInOrganization(input.serverId, organizationId);

			const created = await createApplication({
				name: input.name,
				description: input.description ?? null,
				appName: input.appName,
				environmentId,
				serverId: input.serverId ?? null,
			});
			await auditFromSession(ctx, organizationId, {
				action: "application.create",
				targetType: "application",
				targetId: created.applicationId,
				targetName: created.name,
			});
			return created;
		}),

	update: protectedProcedure
		.input(
			applicationIdInput.extend({
				name: z.string().min(1).optional(),
				description: z.string().nullable().optional(),
				autoDeploy: z.boolean().optional(),
				isPreviewDeploymentsActive: z.boolean().optional(),
				previewForksRequireApproval: z.boolean().optional(),
				previewEnv: textBlobSchema.nullable().optional(),
				previewLimit: z.number().int().min(0).max(100).optional(),
				previewTtlHours: z.number().int().min(1).max(8760).nullable().optional(),
				watchPaths: watchPathsSchema.nullable().optional(),
				buildArgs: textBlobSchema.nullable().optional(),
				// Hooks are shell commands; the blob cap keeps a 200 MB paste out
				// of the column and off every deploy's command line.
				preDeployCommand: textBlobSchema.nullable().optional(),
				postDeployCommand: textBlobSchema.nullable().optional(),
				pushRegistryId: z.string().nullable().optional(),
				autoUpdateImage: z.boolean().optional(),
				serverId: z.string().nullable().optional(),
				...swarmSpecFields,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			if (
				input.buildArgs !== undefined ||
				input.previewEnv !== undefined ||
				input.preDeployCommand !== undefined ||
				input.postDeployCommand !== undefined
			) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			await assertApplicationAccess(input.applicationId, organizationId);
			await assertServerInOrganization(input.serverId, organizationId);
			await assertHardeningOverrideAllowed(ctx.session, input);
			if (input.pushRegistryId) {
				const reg = await db.query.registry.findFirst({
					where: eq(registry.registryId, input.pushRegistryId),
				});
				if (!reg || reg.organizationId !== organizationId) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
				}
				if (!reg.imagePrefix?.trim()) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: `Registry "${reg.registryName}" has no image prefix — set one before using it as a push target`,
					});
				}
			}

			const { applicationId, ...data } = input;
			const application = await updateApplication(applicationId, data);

			const specChanged = Object.keys(swarmSpecFields).some(
				(key) => input[key as keyof typeof input] !== undefined,
			);
			if (specChanged) {
				await upsertApplicationSwarmService(application);
			}
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? application : redactApplicationSecrets(application);
		}),

	/**
	 * Clone this application (config, env, mounts, ports) into the same or a
	 * different environment; domains and deployments are not copied.
	 */
	duplicate: protectedProcedure
		.input(applicationIdInput.extend({ environmentId: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			const application = await assertApplicationAccess(input.applicationId, organizationId);
			const targetEnvironmentId = input.environmentId ?? application.environmentId;
			if (targetEnvironmentId !== application.environmentId) {
				await assertEnvironmentAccess(targetEnvironmentId, organizationId);
			}
			const created = await duplicateApplication(application, targetEnvironmentId);
			await auditFromSession(ctx, organizationId, {
				action: "application.duplicate",
				targetType: "application",
				targetId: created.applicationId,
				targetName: created.name,
				metadata: { sourceId: input.applicationId },
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? created : redactApplicationSecrets(created);
		}),

	/** Move this application to another environment (any project in the org). */
	move: protectedProcedure
		.input(applicationIdInput.extend({ environmentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const application = await assertApplicationAccess(input.applicationId, organizationId);
			const environment = await assertEnvironmentAccess(input.environmentId, organizationId);
			const updated = await updateApplication(input.applicationId, {
				environmentId: environment.environmentId,
			});
			await auditFromSession(ctx, organizationId, {
				action: "application.move",
				targetType: "application",
				targetId: input.applicationId,
				targetName: application.name,
				metadata: { environmentId: environment.environmentId },
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? updated : redactApplicationSecrets(updated);
		}),

	delete: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.delete");
		const application = await assertApplicationAccess(input.applicationId, organizationId);
		await deleteApplication(application);
		await auditFromSession(ctx, organizationId, {
			action: "application.delete",
			targetType: "application",
			targetId: input.applicationId,
			targetName: application.name,
		});
		return { applicationId: input.applicationId };
	}),

	deploy: protectedProcedure
		.input(applicationIdInput.extend({ title: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const application = await assertApplicationAccess(input.applicationId, organizationId);
			await assertDeployable(application);
			const deploymentId = await queueDeployment({
				applicationId: input.applicationId,
				type: "deploy",
				title: input.title?.trim() || undefined,
				...provenanceForSession(ctx.session),
			});
			await auditFromSession(ctx, organizationId, {
				action: "application.deploy",
				targetType: "application",
				targetId: input.applicationId,
				// Deploys are the bulk of the audit trail; without the name every
				// one of those rows reads as a bare uuid.
				targetName: application.name,
				metadata: { deploymentId },
			});
			return { applicationId: input.applicationId, deploymentId };
		}),

	redeploy: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
		const application = await assertApplicationAccess(input.applicationId, organizationId);
		await assertDeployable(application);
		const deploymentId = await queueDeployment({
			applicationId: input.applicationId,
			type: "redeploy",
			...provenanceForSession(ctx.session),
		});
		return { applicationId: input.applicationId, deploymentId };
	}),

	cancelDeployment: protectedProcedure
		.input(z.object({ deploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const deployment = await db.query.deployments.findFirst({
				where: eq(deployments.deploymentId, input.deploymentId),
				with: { application: { with: { environment: { with: { project: true } } } } },
			});
			if (
				!deployment?.application ||
				deployment.application.environment.project.organizationId !== organizationId
			) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
			}
			await cancelQueuedDeployment(input.deploymentId);
			return { deploymentId: input.deploymentId };
		}),

	saveEnvironment: protectedProcedure
		.input(
			applicationIdInput.extend({
				env: textBlobSchema,
				buildArgs: textBlobSchema.nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			await assertApplicationAccess(input.applicationId, organizationId);
			const application = await saveEnvironment(input.applicationId, input.env, input.buildArgs);
			await upsertApplicationSwarmService(application);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? application : redactApplicationSecrets(application);
		}),

	saveBuildType: protectedProcedure
		.input(
			applicationIdInput.extend({
				buildType: z.enum([
					"dockerfile",
					"heroku_buildpacks",
					"paketo_buildpacks",
					"nixpacks",
					"static",
					"railpack",
				]),
				dockerfile: z.string().nullable().optional(),
				dockerContextPath: z.string().nullable().optional(),
				dockerBuildStage: z.string().nullable().optional(),
				publishDirectory: z
					.string()
					.regex(
						/^[A-Za-z0-9._/-]+$/,
						"publishDirectory may only contain letters, digits, dots, dashes, underscores and slashes",
					)
					.nullable()
					.optional(),
				isStaticSpa: z.boolean().nullable().optional(),
				useBuildCache: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			await assertApplicationAccess(input.applicationId, organizationId);
			const { applicationId, ...data } = input;
			const application = await updateApplication(applicationId, data);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? application : redactApplicationSecrets(application);
		}),

	/** Switch the source type and set the fields relevant to that source. */
	saveSource: protectedProcedure
		.input(
			applicationIdInput.extend({
				sourceType: z.enum(["docker", "git", "github", "gitlab", "bitbucket", "gitea", "drop"]),
				// generic git
				gitUrl: z.string().nullable().optional(),
				gitBranch: z.string().nullable().optional(),
				customGitSSHKeyId: z.string().nullable().optional(),
				// provider-backed git
				repository: z.string().nullable().optional(),
				owner: z.string().nullable().optional(),
				branch: z.string().nullable().optional(),
				buildPath: z.string().optional(),
				githubId: z.string().nullable().optional(),
				gitlabId: z.string().nullable().optional(),
				bitbucketId: z.string().nullable().optional(),
				giteaId: z.string().nullable().optional(),
				// docker
				dockerImage: z.string().nullable().optional(),
				username: z.string().nullable().optional(),
				password: z.string().nullable().optional(),
				registryId: z.string().nullable().optional(),
				autoUpdateImage: z.boolean().optional(),
				autoDeploy: z.boolean().optional(),
				isPreviewDeploymentsActive: z.boolean().optional(),
				previewForksRequireApproval: z.boolean().optional(),
				watchPaths: watchPathsSchema.nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			await assertApplicationAccess(input.applicationId, organizationId);

			// Cross-org reference checks.
			for (const provider of ["github", "gitlab", "bitbucket", "gitea"] as const) {
				const providerId = input[`${provider}Id`];
				if (providerId) {
					await assertGitProviderAccess(provider, providerId, organizationId);
				}
			}
			if (input.customGitSSHKeyId) {
				await assertSshKeyInOrganization(input.customGitSSHKeyId, organizationId);
			}
			if (input.registryId) {
				const reg = await db.query.registry.findFirst({
					where: eq(registry.registryId, input.registryId),
				});
				if (!reg || reg.organizationId !== organizationId) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
				}
			}
			if (input.password !== undefined && input.password !== null) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}

			// Clear every source field, then apply only the ones relevant to
			// the selected source type.
			const cleared = {
				repository: null,
				owner: null,
				branch: null,
				githubId: null,
				gitlabId: null,
				bitbucketId: null,
				giteaId: null,
				gitUrl: null,
				gitBranch: null,
				customGitSSHKeyId: null,
				dockerImage: null,
				username: null,
				password: null,
				registryId: null,
				autoUpdateImage: false,
			};

			const data: Partial<typeof applications.$inferInsert> = {
				...cleared,
				sourceType: input.sourceType,
				...(input.buildPath !== undefined ? { buildPath: input.buildPath } : {}),
				...(input.autoDeploy !== undefined ? { autoDeploy: input.autoDeploy } : {}),
				...(input.isPreviewDeploymentsActive !== undefined
					? { isPreviewDeploymentsActive: input.isPreviewDeploymentsActive }
					: {}),
				...(input.previewForksRequireApproval !== undefined
					? { previewForksRequireApproval: input.previewForksRequireApproval }
					: {}),
				...(input.watchPaths !== undefined ? { watchPaths: input.watchPaths } : {}),
				// Only meaningful for the docker source; the switch below clears
				// it when another source type is selected.
				...(input.autoUpdateImage !== undefined ? { autoUpdateImage: input.autoUpdateImage } : {}),
			};

			switch (input.sourceType) {
				case "git":
					if (input.gitUrl) {
						await assertSafeGitCloneUrl(input.gitUrl);
					}
					data.gitUrl = input.gitUrl ?? null;
					data.gitBranch = input.gitBranch ?? null;
					data.customGitSSHKeyId = input.customGitSSHKeyId ?? null;
					break;
				case "github":
				case "gitlab":
				case "bitbucket":
				case "gitea":
					data.repository = input.repository ?? null;
					data.owner = input.owner ?? null;
					data.branch = input.branch ?? null;
					data[`${input.sourceType}Id`] = input[`${input.sourceType}Id`] ?? null;
					break;
				case "docker":
					if (input.dockerImage) {
						assertSafeDockerImageRef(input.dockerImage);
					}
					data.dockerImage = input.dockerImage ?? null;
					data.username = input.username ?? null;
					data.password = input.password ?? null;
					data.registryId = input.registryId ?? null;
					break;
				case "drop":
					break;
			}

			const application = await updateApplication(input.applicationId, data);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? application : redactApplicationSecrets(application);
		}),

	/** Force-restart every task of the swarm service (`docker service update --force`). */
	reload: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
		const application = await assertApplicationAccess(input.applicationId, organizationId);
		const updated = await reloadApplication(application);
		const canSeeSecrets = await hasCapability(ctx.session.user.id, organizationId, "secrets.read");
		return canSeeSecrets ? updated : redactApplicationSecrets(updated);
	}),

	/** Scale the swarm service back to the configured replica count. */
	start: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
		const application = await assertApplicationAccess(input.applicationId, organizationId);
		if (!(await inspectSwarmService(application.appName))) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Application has not been deployed yet — deploy it first",
			});
		}
		await startApplication(application);
		return { applicationId: application.applicationId };
	}),

	/** Scale the swarm service to 0, keeping config, image and volumes. */
	stop: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
		const application = await assertApplicationAccess(input.applicationId, organizationId);
		await stopApplication(application);
		return { applicationId: application.applicationId };
	}),

	/** Cancel any in-flight deployments for this application (tracked PIDs). */
	killBuild: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
		const application = await assertApplicationAccess(input.applicationId, organizationId);
		const running = await db.query.deployments.findMany({
			where: and(
				eq(deployments.applicationId, application.applicationId),
				inArray(deployments.status, ["queued", "running"]),
			),
			columns: { deploymentId: true },
		});
		for (const row of running) {
			await cancelQueuedDeployment(row.deploymentId);
		}
		return { applicationId: application.applicationId, cancelled: running.length };
	}),

	/**
	 * Roll back to a pinned image (recorded by the deploy engine after every
	 * successful build — `appName:<version>` tags / registry digests) and
	 * record it as a deployment. The swarm service is repointed in place; no
	 * source fetch or build happens.
	 */
	rollback: protectedProcedure
		.input(applicationIdInput.extend({ rollbackId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const application = await assertApplicationAccess(input.applicationId, organizationId);

			const rollback = await db.query.rollbacks.findFirst({
				where: and(
					eq(rollbacks.rollbackId, input.rollbackId),
					eq(rollbacks.applicationId, input.applicationId),
				),
			});
			if (!rollback) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Rollback not found" });
			}
			if (!(await inspectSwarmService(application.appName))) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Application has no running service to roll back — deploy it first",
				});
			}

			const deploymentId = generateId();
			const logPath = getDeploymentLogPath(application.appName, deploymentId);
			const startedAt = new Date();
			const lines = [`Rollback ${deploymentId} started`, `Rolling back to image ${rollback.image}`];
			try {
				await updateSwarmServiceImage(application.appName, rollback.image);
				lines.push("Swarm service updated", "Rollback successful");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				lines.push(`Rollback failed: ${message}`);
				await writeRollbackLog(logPath, lines);
				await db.insert(deployments).values({
					deploymentId,
					title: "Rollback",
					description: `Rollback to ${rollback.image}`,
					status: "error",
					errorMessage: message,
					logPath,
					applicationId: application.applicationId,
					serverId: application.serverId,
					startedAt,
					finishedAt: new Date(),
					trigger: "rollback",
					triggeredBy: ctx.session.user.id,
					commitSha: null,
					commitMessage: rollback.image,
				});
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Rollback failed: ${message}`,
				});
			}
			await writeRollbackLog(logPath, lines);

			const [deployment] = await db
				.insert(deployments)
				.values({
					deploymentId,
					title: "Rollback",
					description: `Rolled back to ${rollback.image}`,
					status: "done",
					logPath,
					applicationId: application.applicationId,
					serverId: application.serverId,
					startedAt,
					finishedAt: new Date(),
					trigger: "rollback",
					triggeredBy: ctx.session.user.id,
					// No commit: the pinned image reference stands in for it.
					commitMessage: rollback.image,
				})
				.returning();
			await updateApplication(application.applicationId, { status: "running" });
			await auditFromSession(ctx, organizationId, {
				action: "application.rollback",
				targetType: "application",
				targetId: application.applicationId,
				targetName: application.name,
				metadata: { rollbackId: rollback.rollbackId, image: rollback.image, deploymentId },
			});

			return { rollback, deployment };
		}),
});
