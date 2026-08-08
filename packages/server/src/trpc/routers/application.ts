import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import {
	assertApplicationAccess,
	assertEnvironmentAccess,
	createApplication,
	deleteApplication,
	duplicateApplication,
	getOrganizationId,
	inspectSwarmService,
	reloadSwarmService,
	saveEnvironment,
	startApplication,
	stopApplication,
	updateApplication,
	updateSwarmServiceImage,
	upsertApplicationSwarmService,
} from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { redactServerCommandLog } from "../../modules/cluster";
import {
	cancelDeployment as cancelQueuedDeployment,
	queueDeployment,
} from "../../modules/deployment";
import { assertCapability, assertWithinQuota, hasCapability } from "../../modules/projects";
import { assertSafeGitCloneUrl } from "../../utils/public-url";
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

/** Fields that change the swarm service spec and trigger a re-upsert. */
const swarmSpecFields = {
	replicas: z.number().int().min(0).optional(),
	memoryReservation: z.string().nullable().optional(),
	memoryLimit: z.string().nullable().optional(),
	cpuReservation: z.string().nullable().optional(),
	cpuLimit: z.string().nullable().optional(),
	command: z.string().nullable().optional(),
	healthCheckSwarm: z.unknown().nullable().optional(),
	restartPolicySwarm: z.unknown().nullable().optional(),
	placementSwarm: z.unknown().nullable().optional(),
	updateConfigSwarm: z.unknown().nullable().optional(),
	rollbackConfigSwarm: z.unknown().nullable().optional(),
	modeSwarm: z.unknown().nullable().optional(),
	labelsSwarm: z.unknown().nullable().optional(),
	networkSwarm: z.unknown().nullable().optional(),
} as const;

/** Verify a git provider connection (github/gitlab/bitbucket/gitea row) belongs to the org. */
const assertGitProviderAccess = assertGitProviderInOrganization;

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
		const canSeeSecrets = await hasCapability(ctx.session.user.id, organizationId, "secrets.read");
		const safe = publicApplicationServer(application);
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
				watchPaths: z.array(z.string()).nullable().optional(),
				buildArgs: z.string().nullable().optional(),
				serverId: z.string().nullable().optional(),
				...swarmSpecFields,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			if (input.buildArgs !== undefined) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			await assertApplicationAccess(input.applicationId, organizationId);
			await assertServerInOrganization(input.serverId, organizationId);

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
			await assertApplicationAccess(input.applicationId, organizationId);
			const deploymentId = await queueDeployment({
				applicationId: input.applicationId,
				type: "deploy",
			});
			await auditFromSession(ctx, organizationId, {
				action: "application.deploy",
				targetType: "application",
				targetId: input.applicationId,
				metadata: { deploymentId },
			});
			return { applicationId: input.applicationId, deploymentId };
		}),

	redeploy: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
		await assertApplicationAccess(input.applicationId, organizationId);
		const deploymentId = await queueDeployment({
			applicationId: input.applicationId,
			type: "redeploy",
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
				env: z.string(),
				buildArgs: z.string().nullable().optional(),
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
				publishDirectory: z.string().nullable().optional(),
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
				autoDeploy: z.boolean().optional(),
				isPreviewDeploymentsActive: z.boolean().optional(),
				watchPaths: z.array(z.string()).nullable().optional(),
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
			};

			const data: Partial<typeof applications.$inferInsert> = {
				...cleared,
				sourceType: input.sourceType,
				...(input.buildPath !== undefined ? { buildPath: input.buildPath } : {}),
				...(input.autoDeploy !== undefined ? { autoDeploy: input.autoDeploy } : {}),
				...(input.isPreviewDeploymentsActive !== undefined
					? { isPreviewDeploymentsActive: input.isPreviewDeploymentsActive }
					: {}),
				...(input.watchPaths !== undefined ? { watchPaths: input.watchPaths } : {}),
			};

			switch (input.sourceType) {
				case "git":
					if (input.gitUrl) {
						try {
							await assertSafeGitCloneUrl(input.gitUrl);
						} catch (error) {
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: error instanceof Error ? error.message : "Invalid git URL",
							});
						}
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
						try {
							assertSafeDockerImageRef(input.dockerImage);
						} catch (error) {
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: error instanceof Error ? error.message : "Invalid docker image",
							});
						}
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

	/** Docker-image source shorthand (Dokploy's saveDockerProvider). */
	saveDockerProvider: protectedProcedure
		.input(
			applicationIdInput.extend({
				dockerImage: z.string().min(1),
				username: z.string().nullable().optional(),
				password: z.string().nullable().optional(),
				registryId: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			if (input.password !== undefined) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			await assertApplicationAccess(input.applicationId, organizationId);
			try {
				assertSafeDockerImageRef(input.dockerImage);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error.message : "Invalid docker image",
				});
			}
			if (input.registryId) {
				const reg = await db.query.registry.findFirst({
					where: eq(registry.registryId, input.registryId),
				});
				if (!reg || reg.organizationId !== organizationId) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Registry not found" });
				}
			}
			const application = await updateApplication(input.applicationId, {
				sourceType: "docker",
				dockerImage: input.dockerImage,
				username: input.username ?? null,
				password: input.password ?? null,
				registryId: input.registryId ?? null,
			});
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
		await reloadSwarmService(application.appName, application.serverId);
		const updated = await updateApplication(application.applicationId, { status: "running" });
		const canSeeSecrets = await hasCapability(ctx.session.user.id, organizationId, "secrets.read");
		return canSeeSecrets ? updated : redactApplicationSecrets(updated);
	}),

	/** Scale the swarm service back to the configured replica count. */
	start: protectedProcedure.input(applicationIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
		const application = await assertApplicationAccess(input.applicationId, organizationId);
		if (!(await inspectSwarmService(application.appName, application.serverId))) {
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
				eq(deployments.status, "running"),
			),
			columns: { deploymentId: true },
		});
		for (const row of running) {
			await cancelQueuedDeployment(row.deploymentId);
		}
		return { applicationId: application.applicationId, cancelled: running.length };
	}),

	/** Paginated deployment history (newest first), excluding previews. */
	readDeployments: protectedProcedure
		.input(
			applicationIdInput.extend({
				page: z
					.object({
						pageIndex: z.number().int().min(0),
						pageSize: z.number().int().min(1).max(100),
					})
					.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);

			const pageIndex = input.page?.pageIndex ?? 0;
			const pageSize = input.page?.pageSize ?? 10;
			const where = and(
				eq(deployments.applicationId, input.applicationId),
				eq(deployments.isPreview, false),
			);

			const [rows, countRows] = await Promise.all([
				db.query.deployments.findMany({
					where,
					orderBy: desc(deployments.createdAt),
					limit: pageSize,
					offset: pageIndex * pageSize,
				}),
				db.select({ count: sql<number>`count(*)::int` }).from(deployments).where(where),
			]);

			return { deployments: rows, total: countRows[0]?.count ?? 0 };
		}),

	/** Roll back to a pinned image and record it as a deployment. */
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

			await updateSwarmServiceImage(application.appName, rollback.image, application.serverId);

			const [deployment] = await db
				.insert(deployments)
				.values({
					title: "Rollback",
					description: `Rolled back to ${rollback.image}`,
					status: "done",
					logPath: "",
					applicationId: application.applicationId,
					serverId: application.serverId,
					startedAt: new Date(),
					finishedAt: new Date(),
				})
				.returning();

			return { rollback, deployment };
		}),
});
