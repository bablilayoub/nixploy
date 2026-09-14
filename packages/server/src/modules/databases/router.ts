import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { databaseLogicals, environments, projects } from "../../db/schema";
import { assertServerInOrganization } from "../../trpc/assert-org-refs";
import type { TRPCContext } from "../../trpc/init";
import { protectedProcedure, router } from "../../trpc/init";
import { redactDatabaseSecrets } from "../../trpc/redact-secrets";
import { textBlobSchema } from "../../utils/input-limits";
import { createTtlCache, DOCKER_LISTING_TTL_MS } from "../../utils/ttl-cache";
import { appNameSchema, assertSafeDockerImageRef } from "../../utils/validators";
import { auditFromSession } from "../audit";
import { unregisterBackupsForService } from "../backups/scheduler";
import { invalidateDockerListings } from "../docker/containers";
import {
	badRequest,
	conflict,
	isUniqueViolation,
	notFound,
	preconditionFailed,
	unauthorized,
} from "../errors";
import {
	assertCapability,
	assertWithinQuota,
	hasCapability,
	resolveCallerOrganizationId,
} from "../projects";
import { generateAppName, isAppNameTaken } from "../services/app-name";
import { SERVICE_REGISTRY, type ServiceIdColumn } from "../services/registry";
import {
	assertSafeDatabaseExternalPort,
	buildConnectionUrl,
	DATABASE_CONFIGS,
	type DatabaseKind,
	type DatabaseRowMap,
	databaseServiceExists,
	deployDatabase,
	duplicateDatabase,
	getDatabaseStatus,
	reloadDatabase,
	removeDatabase,
	startDatabase,
	stopDatabase,
} from "./engine";
import {
	assertLogicalIdentifier,
	assertLogicalNameAvailable,
	buildCreateLogicalCommand,
	buildDropLogicalCommand,
	buildLogicalConnectionUrl,
	findDatabaseContainerId,
	generateLogicalPassword,
	type LogicalDatabaseKind,
	runLogicalCommand,
	supportsLogicalDatabases,
} from "./logical";
import {
	classifyVersionChange,
	DATABASE_VERSIONS,
	imageForVersion,
	isCuratedVersion,
	versionFromImage,
} from "./versions";

/**
 * `getStatus` inspects the swarm service (one dockerode listServices +
 * listTasks) and the database detail page polls it every 30 s per open tab —
 * cache it for 10 s per appName (audit #14). Every lifecycle mutation in this
 * router drops the entry, so a start/stop/deploy still reads through.
 */
const statusCache = createTtlCache<Awaited<ReturnType<typeof getDatabaseStatus>>>({
	ttlMs: DOCKER_LISTING_TTL_MS,
});

/**
 * Forget a database's cached swarm status (lifecycle mutations).
 *
 * A lifecycle change also changes what `docker ps` / `docker service ls` report
 * for that server, so the Docker control center's listing cache is dropped in
 * the same call — the same pairing `invalidateComposeContainers` does.
 */
function invalidateDatabaseStatus(appName: string, serverId: string | null | undefined): void {
	statusCache.invalidate(appName);
	invalidateDockerListings(serverId);
}

/**
 * Factory producing the tRPC router for one database type. All five database
 * routers (postgres/mysql/mariadb/mongo/redis) share the exact same
 * Dokploy-style procedure surface; only the table, id column and per-type
 * credential fields differ.
 */

interface DatabaseRouterOptions<K extends DatabaseKind> {
	kind: K;
	/** Extra credential fields for the create/update inputs (e.g. databaseName). */
	createFields: z.ZodRawShape;
}

function getOrganizationId(ctx: TRPCContext): Promise<string> {
	const session = ctx.session;
	if (!session) {
		throw unauthorized("Sign in to continue");
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
		throw notFound("Environment not found");
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
			throw conflict(`appName "${requested}" is already in use`);
		}
		return requested;
	}
	return generateAppName(name, "db");
}

export function buildDatabaseRouter<K extends DatabaseKind>(options: DatabaseRouterOptions<K>) {
	type Row = DatabaseRowMap[K];

	// Table, primary-key column and input key all come from the service
	// registry, so a new engine cannot be wired up with a typo'd id field.
	const { kind } = options;
	const { table, idColumn } = SERVICE_REGISTRY[kind];
	// Widened to `string`: it is used as a computed key on zod shapes and on
	// untyped input records, where the `\`${K}Id\`` literal buys nothing.
	const idField: string = SERVICE_REGISTRY[kind].idField;
	const config = DATABASE_CONFIGS[kind];
	/** FK column on `database_logical` for this engine (null for redis). */
	const logicalColumn = (
		databaseLogicals as unknown as Record<string, ServiceIdColumn | undefined>
	)[idField];

	/** Primary key of a row of this engine (`row.postgresId`, …). */
	const rowId = (row: Row): string => (row as Record<string, unknown>)[idField] as string;

	/**
	 * Resolve the image/version pair a create or update should store.
	 *
	 * `engineVersion` is the curated path (`postgres:17`); a `dockerImage`
	 * the caller typed always wins and clears the version unless it happens to
	 * be exactly the curated tag. That keeps the two columns from disagreeing,
	 * which is what makes the picker able to preselect the right option.
	 */
	function resolveImageAndVersion(input: {
		dockerImage?: string | null;
		engineVersion?: string | null;
		currentImage?: string;
	}): { dockerImage?: string; engineVersion?: string | null } {
		const explicitImage =
			typeof input.dockerImage === "string" && input.dockerImage !== input.currentImage
				? input.dockerImage
				: undefined;
		if (input.engineVersion != null && explicitImage === undefined) {
			if (!isCuratedVersion(kind, input.engineVersion)) {
				throw badRequest(
					`Unknown ${kind} version "${input.engineVersion}". Pick one of the offered versions or set a custom image.`,
				);
			}
			return {
				dockerImage: imageForVersion(kind, input.engineVersion),
				engineVersion: input.engineVersion,
			};
		}
		if (explicitImage !== undefined) {
			// A custom image drops the curated version unless it IS one.
			return { dockerImage: explicitImage, engineVersion: versionFromImage(kind, explicitImage) };
		}
		return {};
	}

	const createSchema = z.object({
		name: z.string().min(1),
		description: z.string().nullish(),
		appName: appNameSchema.optional(),
		dockerImage: z.string().min(1).default(config.defaultImage),
		/**
		 * Curated engine version (see `versions.ts`). When given without an
		 * explicit `dockerImage`, the image is derived from it.
		 */
		engineVersion: z.string().min(1).max(32).nullish(),
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
	// Two `extend` calls on purpose: mixing the computed `[idField]` key with a
	// differently-typed literal one in a single object literal widens every
	// field of the inferred input to `string | boolean`.
	const updateSchema = createSchema
		.partial()
		.extend({ [idField]: z.string().min(1) })
		.extend({
			// `.partial()` keeps the create-time `.default(config.defaultImage)`,
			// so an update that never mentioned the image (a rename, a port
			// change) arrived as `dockerImage: "postgres:17"` — and on a Postgres
			// 18 row the version guard refused it as a downgrade. Truly optional.
			dockerImage: z.string().min(1).optional(),
			/** Acknowledges the data-loss risk of a major engine upgrade. */
			confirmMajorUpgrade: z.boolean().optional(),
		});

	/** Fetch a row by id and verify it lives in the caller's organization. */
	async function findRowOrThrow(id: string, organizationId: string): Promise<Row> {
		const rows = (await db.select().from(table).where(eq(idColumn, id)).limit(1)) as Row[];
		const row = rows[0];
		if (!row) {
			throw notFound("Database not found");
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
			throw notFound("Database not found");
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
					throw notFound("Project not found");
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
				assertSafeDatabaseExternalPort(input.externalPort);
			}
			const resolved = resolveImageAndVersion({
				dockerImage: input.dockerImage,
				engineVersion: input.engineVersion,
				// On create the schema default counts as "not explicit", so a
				// version alone still picks the image.
				currentImage: input.engineVersion ? config.defaultImage : undefined,
			});
			let dockerImage: string;
			try {
				dockerImage = assertSafeDockerImageRef(resolved.dockerImage ?? input.dockerImage);
			} catch (error) {
				throw badRequest(error instanceof Error ? error.message : "Invalid docker image");
			}
			const engineVersion = resolved.engineVersion ?? versionFromImage(kind, dockerImage);
			const appName = await resolveNewAppName(input.appName, input.name);
			try {
				const inserted = (await db
					.insert(table)
					.values({ ...input, appName, dockerImage, engineVersion })
					.returning()) as Row[];
				const createdRow = inserted[0] as Row;
				await auditFromSession(ctx, organizationId, {
					action: `${kind}.create`,
					targetType: kind,
					targetId: rowId(createdRow),
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
				if (isUniqueViolation(error)) {
					throw conflict(`appName "${appName}" is already in use`);
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
			// Not a column: it only gates the major-upgrade check below.
			delete values.confirmMajorUpgrade;
			// `resolveImageAndVersion` is the single source of truth for the
			// image/version pair; a raw `engineVersion` in the input must not
			// reach the row without going through it.
			delete values.engineVersion;
			if (typeof values.appName === "string" && values.appName !== existing.appName) {
				// The swarm service, its `<appName>-data` volume and every backup
				// row are keyed by appName: renaming a deployed database would
				// orphan all of them. Renames are only allowed before the first start.
				if (await databaseServiceExists(existing.appName)) {
					throw badRequest("appName cannot be changed once the database has been deployed");
				}
				if (await isAppNameTaken(values.appName)) {
					throw conflict(`appName "${values.appName}" is already in use`);
				}
			} else if (values.appName === existing.appName) {
				delete values.appName;
			}
			if (typeof values.externalPort === "number") {
				assertSafeDatabaseExternalPort(values.externalPort);
			}
			// Read from the widened record: the computed-key zod shape above
			// erases the per-field types on `input`.
			const raw = input as Record<string, unknown>;
			const resolved = resolveImageAndVersion({
				dockerImage: typeof raw.dockerImage === "string" ? raw.dockerImage : undefined,
				engineVersion: typeof raw.engineVersion === "string" ? raw.engineVersion : undefined,
				currentImage: existing.dockerImage,
			});
			if (resolved.dockerImage !== undefined) {
				values.dockerImage = resolved.dockerImage;
			}
			if (resolved.engineVersion !== undefined) {
				values.engineVersion = resolved.engineVersion;
			}
			if (typeof values.dockerImage === "string") {
				try {
					values.dockerImage = assertSafeDockerImageRef(values.dockerImage);
				} catch (error) {
					throw badRequest(error instanceof Error ? error.message : "Invalid docker image");
				}
			}
			// Changing the engine version on a service that already has data is a
			// data-directory migration, not a config change: block the direction
			// that can never work and make the risky one explicit.
			const nextVersion = resolved.engineVersion ?? null;
			if (nextVersion && nextVersion !== existing.engineVersion) {
				const verdict = classifyVersionChange(kind, existing.engineVersion, nextVersion);
				if (verdict.kind === "blocked") throw badRequest(verdict.reason);
				if (verdict.kind === "confirm" && raw.confirmMajorUpgrade !== true) {
					throw preconditionFailed(
						`${verdict.reason} Re-send with confirmMajorUpgrade: true once a backup exists.`,
					);
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
			.input(
				z.object({
					[idField]: z.string().min(1),
					environmentId: z.string().optional(),
				}),
			)
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
					targetId: rowId(created),
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
			.input(
				z.object({
					[idField]: z.string().min(1),
					environmentId: z.string().min(1),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
				await assertCapability(ctx.session.user.id, organizationId, "service.write");
				const id = input[idField] as string;
				const row = await findRowOrThrow(id, organizationId);
				await assertEnvironmentAccess(input.environmentId as string, organizationId);
				const updated = await updateRow(id, {
					environmentId: input.environmentId,
				});
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
			await removeDatabase(row.appName, row.serverId, kind, row.environmentId);
			invalidateDatabaseStatus(row.appName, row.serverId);
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
			invalidateDatabaseStatus(row.appName, row.serverId);
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
			invalidateDatabaseStatus(row.appName, row.serverId);
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
			.input(z.object({ [idField]: z.string().min(1), env: textBlobSchema }))
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
					assertSafeDatabaseExternalPort(externalPort);
				}
				const row = await updateRow(id, { externalPort });
				if (await databaseServiceExists(row.appName)) {
					await deployDatabase(kind, row);
					invalidateDatabaseStatus(row.appName, row.serverId);
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
				throw badRequest("Database is not deployed; use start instead");
			}
			await reloadDatabase(row.appName);
			invalidateDatabaseStatus(row.appName, row.serverId);
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
		 * (for services in the same environment); `external` uses the server IP +
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

		/**
		 * Curated engine versions offered by the picker, plus the one this
		 * instance recommends. Free of side effects and cheap — the create
		 * dialog and the General tab both read it.
		 */
		engineVersions: protectedProcedure.query(() => ({
			kind,
			versions: DATABASE_VERSIONS[kind],
			defaultImage: config.defaultImage,
		})),

		/**
		 * Additional logical databases inside this instance. Passwords follow
		 * the same rule as the primary credentials: nulled for callers without
		 * `secrets.read`, never omitted.
		 */
		listLogicalDatabases: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			const row = await findRowOrThrow(input[idField] as string, organizationId);
			if (!logicalColumn || !supportsLogicalDatabases(kind)) return [];
			const rows = await db
				.select()
				.from(databaseLogicals)
				.where(eq(logicalColumn, rowId(row)))
				.orderBy(databaseLogicals.createdAt);
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			const host = row.appName;
			const port = config.internalPort;
			return rows.map((logical) => ({
				...logical,
				password: canSeeSecrets ? logical.password : null,
				connectionUrl: canSeeSecrets
					? buildLogicalConnectionUrl(
							kind as LogicalDatabaseKind,
							{ name: logical.name, username: logical.username, password: logical.password },
							host,
							port,
						)
					: null,
			}));
		}),

		/**
		 * Create another database + owning user inside the running container.
		 * The password is generated here (never supplied by the caller) and
		 * stored encrypted; the SQL travels over stdin, never on argv.
		 */
		createLogicalDatabase: protectedProcedure
			.input(
				z.object({
					[idField]: z.string().min(1),
					name: z.string().min(1).max(63),
					username: z.string().min(1).max(63).optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
				await assertCapability(ctx.session.user.id, organizationId, "service.write");
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
				if (!logicalColumn || !supportsLogicalDatabases(kind)) {
					throw badRequest(`${kind} has no additional databases`);
				}
				const row = await findRowOrThrow(input[idField] as string, organizationId);

				const name = assertLogicalNameAvailable(
					assertLogicalIdentifier((input.name as string).trim().toLowerCase(), "database name"),
					"database name",
				);
				const username = assertLogicalNameAvailable(
					assertLogicalIdentifier(
						((input.username as string | undefined)?.trim().toLowerCase() || `${name}_user`).slice(
							0,
							63,
						),
						"username",
					),
					"username",
				);
				if (name === (row as { databaseName?: string }).databaseName) {
					throw conflict(`"${name}" is this instance's primary database`);
				}
				const password = generateLogicalPassword();

				const containerId = await findDatabaseContainerId(row.appName, row.serverId);
				// The row is written first so a crash between the two leaves a
				// visible (deletable) row rather than an invisible database; the
				// insert is rolled back when the engine refuses.
				const [created] = await db
					.insert(databaseLogicals)
					.values({
						serviceType: kind,
						name,
						username,
						password,
						[idField]: rowId(row),
					})
					.returning()
					.catch((error: unknown) => {
						if (isUniqueViolation(error)) {
							throw conflict(`A database named "${name}" already exists on this instance`);
						}
						throw error;
					});
				if (!created) throw new Error("Failed to record the logical database");

				try {
					await runLogicalCommand(
						containerId,
						row.serverId,
						buildCreateLogicalCommand(kind as LogicalDatabaseKind, { name, username, password }),
					);
				} catch (error) {
					await db
						.delete(databaseLogicals)
						.where(eq(databaseLogicals.databaseLogicalId, created.databaseLogicalId))
						.catch(() => {});
					throw badRequest(
						`Could not create database "${name}": ${error instanceof Error ? error.message : String(error)}`,
					);
				}

				await auditFromSession(ctx, organizationId, {
					action: `${kind}.createLogicalDatabase`,
					targetType: kind,
					targetId: rowId(row),
					targetName: row.name,
					metadata: { database: name, username },
				});
				return {
					...created,
					connectionUrl: buildLogicalConnectionUrl(
						kind as LogicalDatabaseKind,
						{ name, username, password },
						row.appName,
						config.internalPort,
					),
				};
			}),

		/** Drop a logical database and its owning user, then forget the row. */
		deleteLogicalDatabase: protectedProcedure
			.input(
				z.object({
					[idField]: z.string().min(1),
					databaseLogicalId: z.string().min(1),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const organizationId = await getOrganizationId(ctx);
				await assertCapability(ctx.session.user.id, organizationId, "service.delete");
				if (!logicalColumn || !supportsLogicalDatabases(kind)) {
					throw badRequest(`${kind} has no additional databases`);
				}
				const row = await findRowOrThrow(input[idField] as string, organizationId);
				const [logical] = await db
					.select()
					.from(databaseLogicals)
					.where(
						and(
							eq(databaseLogicals.databaseLogicalId, input.databaseLogicalId as string),
							eq(logicalColumn, rowId(row)),
						),
					)
					.limit(1);
				if (!logical) throw notFound("Database not found");

				const containerId = await findDatabaseContainerId(row.appName, row.serverId);
				await runLogicalCommand(
					containerId,
					row.serverId,
					buildDropLogicalCommand(kind as LogicalDatabaseKind, {
						name: logical.name,
						username: logical.username,
					}),
				);
				await db
					.delete(databaseLogicals)
					.where(eq(databaseLogicals.databaseLogicalId, logical.databaseLogicalId));
				await auditFromSession(ctx, organizationId, {
					action: `${kind}.deleteLogicalDatabase`,
					targetType: kind,
					targetId: rowId(row),
					targetName: row.name,
					metadata: { database: logical.name },
				});
				return { databaseLogicalId: logical.databaseLogicalId };
			}),

		/** Live status from the swarm service (also synced back onto the row). */
		getStatus: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx);
			const id = input[idField] as string;
			const row = await findRowOrThrow(id, organizationId);
			const status = await statusCache.get(row.appName, () => getDatabaseStatus(row.appName));
			if (status !== row.status) {
				await updateRow(id, { status });
			}
			return status;
		}),
	});
}
