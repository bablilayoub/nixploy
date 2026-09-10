import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { environments, projects } from "../../db/schema";
import { assertServerInOrganization } from "../../trpc/assert-org-refs";
import type { TRPCContext } from "../../trpc/init";
import { protectedProcedure, router } from "../../trpc/init";
import { redactDatabaseSecrets } from "../../trpc/redact-secrets";
import {
	appNameSchema,
	assertSafeDockerImageRef,
	assertSafePublishedPort,
} from "../../utils/validators";
import { isAppNameTaken } from "../application/app-name";
import { auditFromSession } from "../audit";
import { unregisterBackupsForService } from "../backups/scheduler";
import {
	assertCapability,
	assertWithinQuota,
	hasCapability,
	resolveCallerOrganizationId,
} from "../projects";
import {
	buildConnectionUrl,
	DATABASE_CONFIGS,
	type DatabaseKind,
	type DatabaseRowMap,
	databaseServiceExists,
	deployDatabase,
	duplicateDatabase,
	generateDatabaseAppName,
	getDatabaseStatus,
	reloadDatabase,
	removeDatabase,
	startDatabase,
	stopDatabase,
} from "./engine";

/**
 * Factory producing the tRPC router for one database type. All five database
 * routers (postgres/mysql/mariadb/mongo/redis) share the exact same
 * Dokploy-style procedure surface; only the table, id column and per-type
 * credential fields differ.
 */

interface DatabaseRouterOptions<K extends DatabaseKind> {
	kind: K;
	/** Drizzle pg table for this database type. */
	// biome-ignore lint/suspicious/noExplicitAny: drizzle table generics differ per type
	table: any;
	/** Primary key column of the table (e.g. `postgres.postgresId`). */
	// biome-ignore lint/suspicious/noExplicitAny: drizzle column generics differ per type
	idColumn: any;
	/** Key used for the id in procedure inputs (e.g. `"postgresId"`). */
	idField: string;
	/** Extra credential fields for the create/update inputs (e.g. databaseName). */
	createFields: z.ZodRawShape;
}

function getOrganizationId(ctx: TRPCContext): Promise<string> {
	const session = ctx.session;
	if (!session) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	return resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/** Verify the environment belongs to the caller's active organization. */
async function assertEnvironmentAccess(environmentId: string, organizationId: string) {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	if (!environment || environment.project.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
	}
	return environment;
}

/**
 * Unique appName for a new database row: an explicit name must be free
 * across every service table (the swarm namespace is global — a collision
 * with an application or the platform's own `nixploy-postgres` would let
 * `docker service update`/`rm` hit that service); a generated one is
 * re-rolled on the (unlikely) collision.
 */
async function resolveNewAppName(requested: string | undefined, name: string): Promise<string> {
	if (requested) {
		if (await isAppNameTaken(requested)) {
			throw new TRPCError({
				code: "CONFLICT",
				message: `appName "${requested}" is already in use`,
			});
		}
		return requested;
	}
	for (let attempt = 0; attempt < 10; attempt++) {
		const candidate = generateDatabaseAppName(name);
		if (!(await isAppNameTaken(candidate))) return candidate;
	}
	throw new TRPCError({
		code: "INTERNAL_SERVER_ERROR",
		message: `Could not generate a unique appName for "${name}"`,
	});
}

export function buildDatabaseRouter<K extends DatabaseKind>(options: DatabaseRouterOptions<K>) {
	type Row = DatabaseRowMap[K];

	const { kind, table, idColumn, idField } = options;
	const config = DATABASE_CONFIGS[kind];

	const createSchema = z.object({
		name: z.string().min(1),
		description: z.string().nullish(),
		appName: appNameSchema.optional(),
		dockerImage: z.string().min(1).default(config.defaultImage),
		environmentId: z.string().min(1),
		serverId: z.string().nullish(),
		externalPort: z.number().int().min(1).max(65535).nullish(),
		command: z.string().nullish(),
		memoryReservation: z.string().nullish(),
		memoryLimit: z.string().nullish(),
		cpuReservation: z.string().nullish(),
		cpuLimit: z.string().nullish(),
		...options.createFields,
	});

	const idSchema = z.object({ [idField]: z.string().min(1) });
	const updateSchema = createSchema.partial().extend({ [idField]: z.string().min(1) });

	/** Fetch a row by id and verify it lives in the caller's organization. */
	async function findRowOrThrow(id: string, organizationId: string): Promise<Row> {
		const rows = (await db.select().from(table).where(eq(idColumn, id)).limit(1)) as Row[];
		const row = rows[0];
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Database not found" });
		}
		await assertEnvironmentAccess(row.environmentId, organizationId);
		return row;
	}

	async function updateRow(id: string, values: Record<string, unknown>): Promise<Row> {
		const updated = (await db
			.update(table)
			.set(values)
			.where(eq(idColumn, id))
			.returning()) as Row[];
		const row = updated[0];
		if (!row) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Database not found" });
		}
		return row;
	}

	return router({
		/** List databases of this type in a project (optionally one environment). */
		all: protectedProcedure
			.input(
				z.object({
					projectId: z.string().min(1),
					environmentName: z.string().optional(),
				}),
			)
			.query(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
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
				if (envs.length === 0) return [] as Row[];
				const rows = (await db
					.select()
					.from(table)
					.where(
						inArray(
							table.environmentId,
							envs.map((e) => e.environmentId),
						),
					)) as Row[];
				const canSeePassword = await hasCapability(
					ctx.session.user.id,
					organizationId,
					"secrets.read",
				);
				if (canSeePassword) return rows;
				return rows.map((row) => redactDatabaseSecrets(row as Record<string, unknown>) as Row);
			}),

		/** Fetch a single database by id. */
		one: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			const row = await findRowOrThrow(input[idField] as string, organizationId);
			const canSeePassword = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			if (canSeePassword) return row;
			return redactDatabaseSecrets(row as Record<string, unknown>) as Row;
		}),

		/** Create the database row (does not start the container; use `start`). */
		create: protectedProcedure.input(createSchema).mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			await assertCapability(ctx.session.user.id, organizationId, "service.create");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			await assertWithinQuota(organizationId, { services: true });
			await assertEnvironmentAccess(input.environmentId, organizationId);
			await assertServerInOrganization(input.serverId, organizationId);
			if (input.externalPort != null) {
				assertSafePublishedPort(input.externalPort, "externalPort");
			}
			let dockerImage: string;
			try {
				dockerImage = assertSafeDockerImageRef(input.dockerImage);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error.message : "Invalid docker image",
				});
			}
			const appName = await resolveNewAppName(input.appName, input.name);
			try {
				const inserted = (await db
					.insert(table)
					.values({ ...input, appName, dockerImage })
					.returning()) as Row[];
				const createdRow = inserted[0] as Row;
				await auditFromSession(ctx, organizationId, {
					action: `${kind}.create`,
					targetType: kind,
					targetId: (createdRow as unknown as Record<string, unknown>)[idField] as string,
					targetName: createdRow.name,
				});
				const canSeeSecrets = await hasCapability(
					ctx.session.user.id,
					organizationId,
					"secrets.read",
				);
				return canSeeSecrets
					? createdRow
					: (redactDatabaseSecrets(createdRow as Record<string, unknown>) as Row);
			} catch (error) {
				if (
					typeof error === "object" &&
					error !== null &&
					(error as { code?: string }).code === "23505"
				) {
					throw new TRPCError({
						code: "CONFLICT",
						message: `appName "${appName}" is already in use`,
					});
				}
				throw error;
			}
		}),

		/** Update database settings (redeploy with `reload` to apply them). */
		update: protectedProcedure.input(updateSchema).mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const id = input[idField] as string;
			const existing = await findRowOrThrow(id, organizationId);
			if (input.environmentId && input.environmentId !== existing.environmentId) {
				await assertEnvironmentAccess(input.environmentId, organizationId);
			}
			await assertServerInOrganization(input.serverId, organizationId);
			const { [idField]: _id, ...values } = input as Record<string, unknown>;
			if (typeof values.appName === "string" && values.appName !== existing.appName) {
				// The swarm service, its `<appName>-data` volume and every backup
				// row are keyed by appName: renaming a deployed database would
				// orphan all of them. Renames are only allowed before the first start.
				if (await databaseServiceExists(existing.appName)) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "appName cannot be changed once the database has been deployed",
					});
				}
				if (await isAppNameTaken(values.appName)) {
					throw new TRPCError({
						code: "CONFLICT",
						message: `appName "${values.appName}" is already in use`,
					});
				}
			} else if (values.appName === existing.appName) {
				delete values.appName;
			}
			if (typeof values.externalPort === "number") {
				assertSafePublishedPort(values.externalPort, "externalPort");
			}
			if (typeof values.dockerImage === "string") {
				try {
					values.dockerImage = assertSafeDockerImageRef(values.dockerImage);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: error instanceof Error ? error.message : "Invalid docker image",
					});
				}
			}
			const touchesSecrets =
				values.databasePassword !== undefined ||
				values.databaseRootPassword !== undefined ||
				values.env !== undefined;
			if (touchesSecrets) {
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}
			const updated = await updateRow(id, values);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets
				? updated
				: (redactDatabaseSecrets(updated as Record<string, unknown>) as Row);
		}),

		/**
		 * Clone this database (credentials, config) into the same or a
		 * different environment; the data volume is not copied.
		 */
		duplicate: protectedProcedure
			.input(z.object({ [idField]: z.string().min(1), environmentId: z.string().optional() }))
			.mutation(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
				await assertCapability(ctx.session.user.id, organizationId, "service.write");
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
				const row = await findRowOrThrow(input[idField] as string, organizationId);
				const targetEnvironmentId =
					(input.environmentId as string | undefined) ?? row.environmentId;
				if (targetEnvironmentId !== row.environmentId) {
					await assertEnvironmentAccess(targetEnvironmentId, organizationId);
				}
				const created = await duplicateDatabase(kind, row, targetEnvironmentId);
				await auditFromSession(ctx, organizationId, {
					action: `${kind}.duplicate`,
					targetType: kind,
					targetId: (created as unknown as Record<string, unknown>)[idField] as string,
					targetName: created.name,
					metadata: { sourceId: input[idField] as string },
				});
				const canSeeSecrets = await hasCapability(
					ctx.session.user.id,
					organizationId,
					"secrets.read",
				);
				return canSeeSecrets
					? created
					: (redactDatabaseSecrets(created as Record<string, unknown>) as Row);
			}),

		/** Move this database to another environment (any project in the org). */
		move: protectedProcedure
			.input(z.object({ [idField]: z.string().min(1), environmentId: z.string().min(1) }))
			.mutation(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
				await assertCapability(ctx.session.user.id, organizationId, "service.write");
				const id = input[idField] as string;
				const row = await findRowOrThrow(id, organizationId);
				await assertEnvironmentAccess(input.environmentId as string, organizationId);
				const updated = await updateRow(id, { environmentId: input.environmentId });
				await auditFromSession(ctx, organizationId, {
					action: `${kind}.move`,
					targetType: kind,
					targetId: id,
					targetName: row.name as string,
					metadata: { environmentId: input.environmentId as string },
				});
				const canSeeSecrets = await hasCapability(
					ctx.session.user.id,
					organizationId,
					"secrets.read",
				);
				return canSeeSecrets
					? updated
					: (redactDatabaseSecrets(updated as Record<string, unknown>) as Row);
			}),

		/** Remove the database row, its swarm service and its data volume. */
		remove: protectedProcedure.input(idSchema).mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			await assertCapability(ctx.session.user.id, organizationId, "service.delete");
			const id = input[idField] as string;
			const row = await findRowOrThrow(id, organizationId);
			// Cancel the row's backup crons first so they cannot fire mid-teardown.
			unregisterBackupsForService({ appName: row.appName });
			await removeDatabase(row.appName, row.serverId, kind);
			await db.delete(table).where(eq(idColumn, id));
			await auditFromSession(ctx, organizationId, {
				action: `${kind}.delete`,
				targetType: kind,
				targetId: id,
				targetName: row.name as string,
			});
			return true;
		}),

		/** Deploy (create/update) the swarm service and scale it to 1 replica. */
		start: protectedProcedure.input(idSchema).mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
			const id = input[idField] as string;
			const row = await findRowOrThrow(id, organizationId);
			await startDatabase(kind, row);
			const updated = await updateRow(id, { status: "running" });
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets
				? updated
				: (redactDatabaseSecrets(updated as Record<string, unknown>) as Row);
		}),

		/** Scale the swarm service to 0 replicas. */
		stop: protectedProcedure.input(idSchema).mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
			const id = input[idField] as string;
			const row = await findRowOrThrow(id, organizationId);
			await stopDatabase(row.appName);
			const updated = await updateRow(id, { status: "idle" });
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets
				? updated
				: (redactDatabaseSecrets(updated as Record<string, unknown>) as Row);
		}),

		/** Save service-level env vars (multi-line `KEY=VALUE`). */
		saveEnvironment: protectedProcedure
			.input(z.object({ [idField]: z.string().min(1), env: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
				const id = input[idField] as string;
				await findRowOrThrow(id, organizationId);
				const updated = await updateRow(id, { env: input.env });
				const canSeeSecrets = await hasCapability(
					ctx.session.user.id,
					organizationId,
					"secrets.read",
				);
				return canSeeSecrets
					? updated
					: (redactDatabaseSecrets(updated as Record<string, unknown>) as Row);
			}),

		/**
		 * Set/clear the published host port. Redeploys the service when it is
		 * already deployed so the port mapping takes effect immediately.
		 */
		saveExternalPort: protectedProcedure
			.input(
				z.object({
					[idField]: z.string().min(1),
					externalPort: z.number().int().min(1).max(65535).nullable(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
				await assertCapability(ctx.session.user.id, organizationId, "service.write");
				const id = input[idField] as string;
				await findRowOrThrow(id, organizationId);
				const externalPort = input.externalPort;
				if (typeof externalPort === "number") {
					assertSafePublishedPort(externalPort, "externalPort");
				}
				const row = await updateRow(id, { externalPort });
				if (await databaseServiceExists(row.appName)) {
					await deployDatabase(kind, row);
				}
				const canSeeSecrets = await hasCapability(
					ctx.session.user.id,
					organizationId,
					"secrets.read",
				);
				return canSeeSecrets ? row : (redactDatabaseSecrets(row as Record<string, unknown>) as Row);
			}),

		/** Force a rolling re-creation of the service's tasks. */
		reload: protectedProcedure.input(idSchema).mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
			const id = input[idField] as string;
			const row = await findRowOrThrow(id, organizationId);
			if (!(await databaseServiceExists(row.appName))) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Database is not deployed; use start instead",
				});
			}
			await reloadDatabase(row.appName);
			const updated = await updateRow(id, { status: "running" });
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets
				? updated
				: (redactDatabaseSecrets(updated as Record<string, unknown>) as Row);
		}),

		/**
		 * Connection URLs: `internal` uses the swarm service name + native port
		 * (for services on `nixploy-network`); `external` uses the server IP +
		 * published port (null when no external port is configured).
		 */
		getConnectionUrl: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			await assertCapability(ctx.session.user.id, organizationId, "secrets.read");
			const row = await findRowOrThrow(input[idField] as string, organizationId);
			const internal = await buildConnectionUrl(kind, row);
			const external = row.externalPort
				? await buildConnectionUrl(kind, row, { external: true })
				: null;
			return { internal, external };
		}),

		/** Live status from the swarm service (also synced back onto the row). */
		getStatus: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			const id = input[idField] as string;
			const row = await findRowOrThrow(id, organizationId);
			const status = await getDatabaseStatus(row.appName);
			if (status !== row.status) {
				await updateRow(id, { status });
			}
			return status;
		}),
	});
}
