import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
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
	redis,
} from "../../db/schema";
import { duplicateApplication } from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { duplicateCompose } from "../../modules/compose/service";
import { duplicateDatabase } from "../../modules/databases/engine";
import {
	assertCapability,
	deleteEnvironmentCascade,
	emptyServiceCounts,
	findEnvironmentById,
	findProjectById,
	getServiceCountsByEnvironment,
	hasCapability,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/** Reject names already used by another environment in the same project. */
async function assertEnvironmentNameAvailable(
	projectId: string,
	name: string,
	exceptEnvironmentId?: string,
): Promise<void> {
	const existing = await db.query.environments.findMany({
		where: eq(environments.projectId, projectId),
	});
	if (
		existing.some(
			(environment) =>
				environment.name === name && environment.environmentId !== exceptEnvironmentId,
		)
	) {
		throw new TRPCError({
			code: "CONFLICT",
			message: `Environment "${name}" already exists in this project`,
		});
	}
}

export const environmentRouter = router({
	/** All environments of a project, with per-environment service counts. */
	byProject: protectedProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			const project = await findProjectById(input.projectId, organizationId);
			const environmentList = await db.query.environments.findMany({
				where: eq(environments.projectId, project.projectId),
				orderBy: asc(environments.createdAt),
			});
			const countsByEnvironment = await getServiceCountsByEnvironment(
				environmentList.map((environment) => environment.environmentId),
			);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return environmentList.map((environment) => ({
				...(canSeeSecrets ? environment : { ...environment, env: null }),
				services: countsByEnvironment.get(environment.environmentId) ?? emptyServiceCounts(),
			}));
		}),

	/** Create an environment inside a project of the caller's organization. */
	create: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				name: z.string().min(1).max(255),
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
			const project = await findProjectById(input.projectId, organizationId);
			await assertEnvironmentNameAvailable(project.projectId, input.name);
			const [environment] = await db
				.insert(environments)
				.values({
					name: input.name,
					description: input.description ?? null,
					...(input.env ? { env: input.env } : {}),
					projectId: project.projectId,
				})
				.returning();
			return environment;
		}),

	/** Update name/description and/or environment-level env vars (dotenv string). */
	update: protectedProcedure
		.input(
			z.object({
				environmentId: z.string().min(1),
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
			const current = await findEnvironmentById(input.environmentId, organizationId);
			if (input.name !== undefined) {
				await assertEnvironmentNameAvailable(current.projectId, input.name, input.environmentId);
			}
			const [updated] = await db
				.update(environments)
				.set({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.description !== undefined ? { description: input.description } : {}),
					...(input.env !== undefined ? { env: input.env } : {}),
				})
				.where(eq(environments.environmentId, input.environmentId))
				.returning();
			return updated;
		}),

	/**
	 * Delete an environment and every service inside it: Swarm services,
	 * Traefik configs, volumes and on-disk state, best-effort per service.
	 */
	delete: protectedProcedure
		.input(z.object({ environmentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.delete");
			const environment = await findEnvironmentById(input.environmentId, organizationId);
			await deleteEnvironmentCascade(environment.environmentId);
			return environment;
		}),

	/**
	 * Duplicate an environment within the same project, copying its
	 * description and env vars. Services are NOT copied.
	 */
	duplicate: protectedProcedure
		.input(
			z.object({
				environmentId: z.string().min(1),
				name: z.string().min(1).max(255).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			const source = await findEnvironmentById(input.environmentId, organizationId);
			await assertEnvironmentNameAvailable(source.projectId, input.name ?? `${source.name} copy`);
			const [duplicate] = await db
				.insert(environments)
				.values({
					name: input.name ?? `${source.name} copy`,
					description: source.description,
					...(source.env ? { env: source.env } : {}),
					projectId: source.projectId,
				})
				.returning();
			return duplicate;
		}),

	/**
	 * Clone an environment within the same project, INCLUDING every service
	 * in it (applications, compose and all five database kinds are duplicated
	 * with fresh appNames; domains and deployments are not copied).
	 */
	clone: protectedProcedure
		.input(
			z.object({
				environmentId: z.string().min(1),
				name: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "project.write");
			const source = await findEnvironmentById(input.environmentId, organizationId);
			await assertEnvironmentNameAvailable(source.projectId, input.name);
			const [environment] = await db
				.insert(environments)
				.values({
					name: input.name,
					description: source.description,
					...(source.env ? { env: source.env } : {}),
					projectId: source.projectId,
				})
				.returning();
			if (!environment) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create environment",
				});
			}

			const [apps, composeRows, pg, my, maria, mongoRows, redisRows] = await Promise.all([
				db.query.applications.findMany({
					where: eq(applications.environmentId, source.environmentId),
				}),
				db.query.compose.findMany({
					where: eq(compose.environmentId, source.environmentId),
				}),
				db.query.postgres.findMany({
					where: eq(postgres.environmentId, source.environmentId),
				}),
				db.query.mysql.findMany({
					where: eq(mysql.environmentId, source.environmentId),
				}),
				db.query.mariadb.findMany({
					where: eq(mariadb.environmentId, source.environmentId),
				}),
				db.query.mongo.findMany({
					where: eq(mongo.environmentId, source.environmentId),
				}),
				db.query.redis.findMany({
					where: eq(redis.environmentId, source.environmentId),
				}),
			]);

			for (const row of apps) {
				await duplicateApplication(row, environment.environmentId);
			}
			for (const row of composeRows) {
				await duplicateCompose(row, environment.environmentId);
			}
			for (const row of pg) {
				await duplicateDatabase("postgres", row, environment.environmentId);
			}
			for (const row of my) {
				await duplicateDatabase("mysql", row, environment.environmentId);
			}
			for (const row of maria) {
				await duplicateDatabase("mariadb", row, environment.environmentId);
			}
			for (const row of mongoRows) {
				await duplicateDatabase("mongo", row, environment.environmentId);
			}
			for (const row of redisRows) {
				await duplicateDatabase("redis", row, environment.environmentId);
			}

			const cloned =
				apps.length +
				composeRows.length +
				pg.length +
				my.length +
				maria.length +
				mongoRows.length +
				redisRows.length;
			await auditFromSession(ctx, organizationId, {
				action: "environment.clone",
				targetType: "environment",
				targetId: environment.environmentId,
				targetName: environment.name,
				metadata: { sourceId: source.environmentId, servicesCloned: cloned },
			});
			return { ...environment, servicesCloned: cloned };
		}),

	/**
	 * Persist the environment-level env vars (dotenv string). The column is
	 * encrypted at rest; values override project-level vars on key conflicts.
	 */
	saveEnvironment: protectedProcedure
		.input(
			z.object({
				environmentId: z.string().min(1),
				env: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			await findEnvironmentById(input.environmentId, organizationId);
			const [updated] = await db
				.update(environments)
				.set({ env: input.env })
				.where(eq(environments.environmentId, input.environmentId))
				.returning();
			return updated;
		}),
});
