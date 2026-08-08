import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
	applications,
	compose,
	environments,
	mariadb,
	mongo,
	mysql,
	postgres,
	projects,
	redis,
} from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { getDeploymentStatsSince } from "../../modules/deployment/queries";
import {
	assertCapability,
	assertWithinQuota,
	deleteProjectCascade,
	emptyServiceCounts,
	findProjectById,
	getEnvironmentServices,
	getOrganizationServiceStatusCounts,
	getServiceCountsByEnvironment,
	hasCapability,
	resolveCallerOrganizationId,
	resolveEnvironmentVariables,
	toEnvString,
} from "../../modules/projects";
import { protectedProcedure, router } from "../init";
import { redactEnvironmentServicesSecrets } from "../redact-secrets";

const projectIdInput = z.object({ projectId: z.string().min(1) });

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const SEARCH_LIMIT = 20;

export const projectRouter = router({
	/**
	 * List all projects of the caller's active organization (falling back to
	 * their first member organization), each with its environments and
	 * per-environment service counts.
	 */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const projectList = await db.query.projects.findMany({
			where: eq(projects.organizationId, organizationId),
			orderBy: desc(projects.createdAt),
			with: {
				environments: {
					orderBy: asc(environments.createdAt),
				},
			},
		});
		const environmentIds = projectList.flatMap((project) =>
			project.environments.map((environment) => environment.environmentId),
		);
		const countsByEnvironment = await getServiceCountsByEnvironment(environmentIds);
		const canSeeSecrets = await hasCapability(ctx.session.user.id, organizationId, "secrets.read");
		return projectList.map((project) => ({
			...(canSeeSecrets ? project : { ...project, env: null }),
			environments: project.environments.map((environment) => ({
				...(canSeeSecrets ? environment : { ...environment, env: null }),
				services: countsByEnvironment.get(environment.environmentId) ?? emptyServiceCounts(),
			})),
		}));
	}),

	/**
	 * Organization-wide dashboard overview: project count, service counts by
	 * status (all service kinds), and deployment counts of the last 24 hours.
	 */
	overview: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const [projectRows, services, deploymentsLastDay] = await Promise.all([
			db
				.select({ value: count() })
				.from(projects)
				.where(eq(projects.organizationId, organizationId)),
			getOrganizationServiceStatusCounts(organizationId),
			getDeploymentStatsSince(organizationId, new Date(Date.now() - DAY_IN_MS)),
		]);
		return {
			projectCount: projectRows[0]?.value ?? 0,
			services,
			deploymentsLastDay,
		};
	}),

	/** One project with its environments and every service inside them. */
	one: protectedProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const project = await findProjectById(input.projectId, organizationId);
		const environmentList = await db.query.environments.findMany({
			where: eq(environments.projectId, project.projectId),
			orderBy: asc(environments.createdAt),
		});
		const canSeeSecrets = await hasCapability(ctx.session.user.id, organizationId, "secrets.read");
		const environmentsWithServices = await Promise.all(
			environmentList.map(async (environment) => {
				const services = await getEnvironmentServices(environment.environmentId);
				return {
					...(canSeeSecrets ? environment : { ...environment, env: null }),
					services: canSeeSecrets ? services : redactEnvironmentServicesSecrets(services),
				};
			}),
		);
		return {
			...(canSeeSecrets ? project : { ...project, env: null }),
			environments: environmentsWithServices,
		};
	}),

	/**
	 * Organization-wide service search (command palette): every service kind
	 * whose name contains the query, annotated with its project.
	 */
	search: protectedProcedure
		.input(z.object({ query: z.string().trim().min(1).max(100) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			const orgProjects = await db.query.projects.findMany({
				where: eq(projects.organizationId, organizationId),
				columns: { projectId: true, name: true },
			});
			if (orgProjects.length === 0) return [];
			const projectNameById = new Map(orgProjects.map((p) => [p.projectId, p.name]));
			const environmentList = await db.query.environments.findMany({
				where: inArray(
					environments.projectId,
					orgProjects.map((p) => p.projectId),
				),
				columns: { environmentId: true, projectId: true },
			});
			if (environmentList.length === 0) return [];
			const projectIdByEnvironment = new Map(
				environmentList.map((e) => [e.environmentId, e.projectId]),
			);
			const environmentIds = environmentList.map((e) => e.environmentId);
			const pattern = `%${input.query}%`;

			const [apps, composeRows, pg, my, maria, mongoRows, redisRows] = await Promise.all([
				db.query.applications.findMany({
					where: and(
						ilike(applications.name, pattern),
						inArray(applications.environmentId, environmentIds),
					),
					columns: { applicationId: true, name: true, status: true, environmentId: true },
					limit: SEARCH_LIMIT,
				}),
				db.query.compose.findMany({
					where: and(ilike(compose.name, pattern), inArray(compose.environmentId, environmentIds)),
					columns: { composeId: true, name: true, status: true, environmentId: true },
					limit: SEARCH_LIMIT,
				}),
				db.query.postgres.findMany({
					where: and(
						ilike(postgres.name, pattern),
						inArray(postgres.environmentId, environmentIds),
					),
					columns: { postgresId: true, name: true, status: true, environmentId: true },
					limit: SEARCH_LIMIT,
				}),
				db.query.mysql.findMany({
					where: and(ilike(mysql.name, pattern), inArray(mysql.environmentId, environmentIds)),
					columns: { mysqlId: true, name: true, status: true, environmentId: true },
					limit: SEARCH_LIMIT,
				}),
				db.query.mariadb.findMany({
					where: and(ilike(mariadb.name, pattern), inArray(mariadb.environmentId, environmentIds)),
					columns: { mariadbId: true, name: true, status: true, environmentId: true },
					limit: SEARCH_LIMIT,
				}),
				db.query.mongo.findMany({
					where: and(ilike(mongo.name, pattern), inArray(mongo.environmentId, environmentIds)),
					columns: { mongoId: true, name: true, status: true, environmentId: true },
					limit: SEARCH_LIMIT,
				}),
				db.query.redis.findMany({
					where: and(ilike(redis.name, pattern), inArray(redis.environmentId, environmentIds)),
					columns: { redisId: true, name: true, status: true, environmentId: true },
					limit: SEARCH_LIMIT,
				}),
			]);

			const results = [
				...apps.map((row) => ({ type: "application" as const, id: row.applicationId, ...row })),
				...composeRows.map((row) => ({ type: "compose" as const, id: row.composeId, ...row })),
				...pg.map((row) => ({ type: "postgres" as const, id: row.postgresId, ...row })),
				...my.map((row) => ({ type: "mysql" as const, id: row.mysqlId, ...row })),
				...maria.map((row) => ({ type: "mariadb" as const, id: row.mariadbId, ...row })),
				...mongoRows.map((row) => ({ type: "mongo" as const, id: row.mongoId, ...row })),
				...redisRows.map((row) => ({ type: "redis" as const, id: row.redisId, ...row })),
			];

			return results
				.map((row) => {
					const projectId = projectIdByEnvironment.get(row.environmentId) ?? "";
					return {
						type: row.type,
						id: row.id,
						name: row.name,
						status: row.status,
						projectId,
						projectName: projectNameById.get(projectId) ?? "",
					};
				})
				.filter((row) => row.projectId)
				.slice(0, SEARCH_LIMIT);
		}),

	/**
	 * Create a project in the caller's organization. A default `production`
	 * environment is created automatically.
	 */
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(255),
				description: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			await assertWithinQuota(organizationId, { projects: true });
			const [project] = await db
				.insert(projects)
				.values({
					name: input.name,
					description: input.description ?? null,
					organizationId,
				})
				.returning();
			if (!project) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create project",
				});
			}
			await db.insert(environments).values({
				name: "production",
				description: "Default production environment",
				projectId: project.projectId,
			});
			await auditFromSession(ctx, organizationId, {
				action: "project.create",
				targetType: "project",
				targetId: project.projectId,
				targetName: project.name,
			});
			return project;
		}),

	/** Update name/description and/or project-level env vars (dotenv string). */
	update: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				name: z.string().min(1).max(255).optional(),
				description: z.string().nullish(),
				env: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			if (input.env !== undefined) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			await findProjectById(input.projectId, organizationId);
			const [updated] = await db
				.update(projects)
				.set({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.description !== undefined ? { description: input.description } : {}),
					...(input.env !== undefined ? { env: input.env } : {}),
				})
				.where(eq(projects.projectId, input.projectId))
				.returning();
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? updated : { ...updated, env: null };
		}),

	/**
	 * Delete a project and everything inside it: every environment, every
	 * service (Swarm services, Traefik configs, volumes and on-disk state),
	 * then the project row itself.
	 */
	delete: protectedProcedure.input(projectIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "project.delete");
		const project = await findProjectById(input.projectId, organizationId);
		await deleteProjectCascade(project.projectId);
		await auditFromSession(ctx, organizationId, {
			action: "project.delete",
			targetType: "project",
			targetId: project.projectId,
			targetName: project.name,
		});
		return { ...project, env: null };
	}),

	/**
	 * Persist the project-level env vars (dotenv string). The column is
	 * encrypted at rest; the value is stored verbatim and parsed downstream
	 * by the env-resolution module.
	 */
	saveEnvironment: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				env: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			await findProjectById(input.projectId, organizationId);
			const [updated] = await db
				.update(projects)
				.set({ env: input.env })
				.where(eq(projects.projectId, input.projectId))
				.returning();
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? updated : { ...updated, env: null };
		}),

	/**
	 * Preview the effective env vars of one environment of the project:
	 * organization → project → environment merged (deeper level wins),
	 * serialized back to a dotenv string for display.
	 */
	getResolvedEnvironment: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				environmentName: z.string().min(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "secrets.read");
			const project = await findProjectById(input.projectId, organizationId);
			const environment = await db.query.environments.findFirst({
				where: and(
					eq(environments.projectId, project.projectId),
					eq(environments.name, input.environmentName),
				),
			});
			if (!environment) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Environment "${input.environmentName}" not found in this project`,
				});
			}
			const resolved = await resolveEnvironmentVariables(environment.environmentId);
			return {
				projectId: project.projectId,
				environmentId: environment.environmentId,
				environmentName: environment.name,
				env: toEnvString(resolved),
			};
		}),
});
