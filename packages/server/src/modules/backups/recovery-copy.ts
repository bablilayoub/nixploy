import { randomBytes } from "node:crypto";
import {
	and,
	desc,
	eq,
	getTableColumns,
	inArray,
	isNull,
	lt,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { db } from "../../db";
import {
	backups,
	destinations,
	environments,
	postgres,
	projects,
	recoveryCopies,
	servers,
} from "../../db/schema";
import { execAsyncWithStdin } from "../../utils/exec";
import { assertSafeAppName, assertSafeDockerImageRef } from "../../utils/validators";
import { shellQuote } from "../compose/paths";
import {
	deployDatabase,
	type PostgresRow,
	postgresMajorVersion,
	removeDatabase,
} from "../databases/engine";
import { findDatabaseContainerId, generateLogicalPassword } from "../databases/logical";
import { databaseSwarmNodeId } from "../databases/placement";
import { conflict, notFound, preconditionFailed } from "../errors";
import { projectIdFilter } from "../projects/project-scope";
import { assertWithinQuota } from "../projects/quotas";
import { generateAppName } from "../services/app-name";
import { withValidatedArchive } from "./archive";
import { DB_DUMP_CONFIG } from "./dump-commands";
import { buildStreamPipeline } from "./pipeline";
import {
	inspectRecoveryRuntime,
	provisionRecoveryVolume,
	type RecoveryOrigin,
	removeOriginalRecoveryVolume,
} from "./recovery-copy-identity";
import { type BackupRow, listBackupKeys, replayArchive } from "./runner";
import { storeFor } from "./storage";

export type RecoveryCopy = typeof recoveryCopies.$inferSelect;
const TERMINAL_STATES = ["ready", "error", "deleted"];
export const RECOVERY_COPY_TIMEOUT_MS = 10 * 60_000;

/** Expired work is unknown, never evidence that a restore completed. */
export function recoveryCopyState(
	row: Pick<RecoveryCopy, "status" | "deadline">,
	now = Date.now(),
) {
	return !TERMINAL_STATES.includes(row.status) && row.deadline.getTime() + 60_000 < now
		? "interrupted"
		: row.status;
}

export function assertRecoveryCopyRetry(
	row: RecoveryCopy,
	input: { backupId: string; environmentId: string; name: string; key: string },
) {
	if (
		row.backupId !== input.backupId ||
		row.environmentId !== input.environmentId ||
		row.name !== input.name ||
		row.objectKey !== input.key
	) {
		throw conflict("This recovery request was already used for a different copy");
	}
}

function remaining(deadline: Date): number {
	const left = deadline.getTime() - Date.now();
	if (left <= 0) throw preconditionFailed("The recovery copy exceeded its time limit");
	return left;
}

async function phase(id: string, status: string, deadline: Date) {
	remaining(deadline);
	const [row] = await db
		.update(recoveryCopies)
		.set({ status })
		.where(
			and(
				eq(recoveryCopies.recoveryCopyId, id),
				notInArray(recoveryCopies.status, ["deleting", ...TERMINAL_STATES]),
			),
		)
		.returning();
	if (!row) throw conflict("This recovery copy is no longer accepting work");
}

const psqlShell = 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"';
async function queryTarget(target: PostgresRow, container: string, sql: string, deadline: Date) {
	return await execAsyncWithStdin(
		`docker exec -i ${shellQuote(container)} sh -c ${shellQuote(psqlShell)}`,
		sql,
		{ serverId: target.serverId, timeout: Math.min(30_000, remaining(deadline)) },
	);
}

async function waitForTarget(target: PostgresRow, deadline: Date): Promise<string> {
	const readyBy = Math.min(deadline.getTime(), Date.now() + 90_000);
	while (Date.now() < readyBy) {
		try {
			const container = await findDatabaseContainerId(target.appName, target.serverId);
			if ((await queryTarget(target, container, "SELECT 1;\n", deadline)).trim() === "1")
				return container;
		} catch {
			// Swarm task creation and PostgreSQL initdb are asynchronous.
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw preconditionFailed("The new PostgreSQL service did not become ready within 90 seconds");
}

/**
 * Restore only into a freshly created managed service. The source is used for
 * image/placement, never for docker exec. Every retry shares one durable ID.
 */
export async function createRecoveryCopy(input: {
	backup: BackupRow;
	source: PostgresRow;
	organizationId: string;
	environmentId: string;
	name: string;
	key: string;
	requestId: string;
}): Promise<RecoveryCopy> {
	const { backup, source } = input;
	if (backup.databaseType !== "postgres" || backup.postgresId !== source.postgresId) {
		throw preconditionFailed("Recovery copies currently support PostgreSQL backups only");
	}
	if (input.environmentId === source.environmentId) {
		throw preconditionFailed("Choose another environment for the private recovery copy");
	}
	const image = assertSafeDockerImageRef(source.dockerImage);
	if (postgresMajorVersion(image) === null) {
		throw preconditionFailed(
			"Use a PostgreSQL image with an explicit major version before creating a recovery copy",
		);
	}
	const [destination] = await db
		.select()
		.from(destinations)
		.where(eq(destinations.destinationId, backup.destinationId));
	if (!destination || destination.organizationId !== input.organizationId)
		throw notFound("Backup destination not found");
	const [previous] = await db
		.select()
		.from(recoveryCopies)
		.where(
			and(
				eq(recoveryCopies.organizationId, input.organizationId),
				eq(recoveryCopies.requestId, input.requestId),
			),
		);
	if (previous) {
		assertRecoveryCopyRetry(previous, { ...input, backupId: backup.backupId });
		return previous;
	}
	await assertWithinQuota(input.organizationId, { services: true });
	if (!(await listBackupKeys(backup)).includes(input.key))
		throw notFound("Stored dump not found for this backup");
	const deadline = new Date(Date.now() + RECOVERY_COPY_TIMEOUT_MS);
	const [copy] = await db
		.insert(recoveryCopies)
		.values({
			organizationId: input.organizationId,
			requestId: input.requestId,
			backupId: backup.backupId,
			sourcePostgresId: source.postgresId,
			environmentId: input.environmentId,
			name: input.name,
			objectKey: input.key,
			deadline,
		})
		.onConflictDoNothing()
		.returning();
	if (!copy) {
		const [concurrent] = await db
			.select()
			.from(recoveryCopies)
			.where(
				and(
					eq(recoveryCopies.organizationId, input.organizationId),
					eq(recoveryCopies.requestId, input.requestId),
				),
			);
		if (!concurrent) throw conflict("Recovery request could not be recorded");
		assertRecoveryCopyRetry(concurrent, { ...input, backupId: backup.backupId });
		return concurrent;
	}
	let target: PostgresRow | undefined;
	let archiveValidated = false;
	try {
		await withValidatedArchive(storeFor(destination), input.key, async (archive) => {
			archiveValidated = true;
			remaining(deadline);
			const appName = await generateAppName(input.name, "db");
			const origin: RecoveryOrigin = {
				recoveryCopyId: copy.recoveryCopyId,
				originServerId: source.serverId,
				originSwarmNodeId: await databaseSwarmNodeId(source.serverId),
				originAppName: appName,
				originVolumeName: `${appName}-data`,
				originVolumeCreatedAt: null,
			};
			const createdTarget = await db.transaction(async (tx) => {
				const [current] = await tx
					.select()
					.from(recoveryCopies)
					.where(eq(recoveryCopies.recoveryCopyId, copy.recoveryCopyId))
					.for("update");
				if (current?.status !== "validating")
					throw conflict("Recovery request is no longer active");
				remaining(deadline);
				const [created] = await tx
					.insert(postgres)
					.values({
						name: input.name,
						appName,
						environmentId: input.environmentId,
						description:
							"Private recovery copy. Retained until you delete it; data is not sanitized.",
						dockerImage: image,
						engineVersion: source.engineVersion,
						serverId: source.serverId,
						databaseName: backup.database,
						databaseUser: `recovery_${randomBytes(8).toString("hex")}`,
						databasePassword: generateLogicalPassword(),
						externalPort: null,
						env: null,
						command: null,
						memoryReservation: source.memoryReservation,
						memoryLimit: source.memoryLimit,
						cpuReservation: source.cpuReservation,
						cpuLimit: source.cpuLimit,
					})
					.returning();
				if (!created) throw conflict("Recovery database could not be created");
				await tx
					.update(recoveryCopies)
					.set({
						targetPostgresId: created.postgresId,
						...origin,
						status: "provisioning",
					})
					.where(eq(recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
				return created;
			});
			target = createdTarget;
			origin.originVolumeCreatedAt = await provisionRecoveryVolume(origin);
			await db
				.update(recoveryCopies)
				.set({ originVolumeCreatedAt: origin.originVolumeCreatedAt })
				.where(eq(recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
			await deployDatabase("postgres", createdTarget);
			const candidate = await waitForTarget(createdTarget, deadline);
			const runtime = await inspectRecoveryRuntime(origin, candidate);
			const container = runtime.containerId;
			if (!container) throw preconditionFailed("The recovery container identity is unknown");
			if (!runtime.volumeCreatedAt)
				throw preconditionFailed("The recovery volume identity is unknown");
			await phase(copy.recoveryCopyId, "restoring", deadline);
			const command = DB_DUMP_CONFIG.postgres.restoreCommand({
				database: target.databaseName,
				databaseUser: target.databaseUser,
				databasePassword: target.databasePassword,
			});
			await replayArchive(
				archive,
				target.serverId,
				buildStreamPipeline(
					"gunzip",
					`docker exec -i ${shellQuote(container)} sh -c ${shellQuote(command)}`,
				),
				remaining(deadline),
				true,
			);
			await phase(copy.recoveryCopyId, "verifying", deadline);
			await inspectRecoveryRuntime(origin, container);
			const count = (
				await queryTarget(
					target,
					container,
					"SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';\n",
					deadline,
				)
			).trim();
			if (!/^\d+$/.test(count))
				throw preconditionFailed("The restored database did not return a table count");
			await inspectRecoveryRuntime(origin, container);
			await db.transaction(async (tx) => {
				remaining(deadline);
				await tx
					.update(postgres)
					.set({ status: "running" })
					.where(eq(postgres.postgresId, createdTarget.postgresId));
				await tx
					.update(recoveryCopies)
					.set({ status: "ready", tableCount: Number(count), finishedAt: new Date(), error: null })
					.where(eq(recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
			});
		});
	} catch {
		// SQL stderr can contain restored data; never persist or expose it.
		const [persisted] = await db
			.select({ targetPostgresId: recoveryCopies.targetPostgresId })
			.from(recoveryCopies)
			.where(eq(recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
		const targetId = target?.postgresId ?? persisted?.targetPostgresId;
		const message = targetId
			? "Recovery did not finish. The incomplete private database is retained for inspection or deletion."
			: archiveValidated
				? "The archive passed validation, but the recovery database could not be created."
				: "The archive could not be validated. No recovery database was created.";
		await db
			.update(recoveryCopies)
			.set({ status: "error", error: message, finishedAt: new Date() })
			.where(eq(recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
		if (targetId)
			await db.update(postgres).set({ status: "error" }).where(eq(postgres.postgresId, targetId));
	}
	const [result] = await db
		.select()
		.from(recoveryCopies)
		.where(eq(recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
	if (!result) throw notFound("Recovery copy not found");
	return result;
}

export async function listRecoveryCopies(
	filter: { backupId: string } | { postgresId: string } | { projectId: string },
	organizationId: string,
	options: { cursor?: { createdAt: string; id: string }; limit?: 100 | 101 } = {},
) {
	// Scope every existing relationship before LIMIT, so hidden history cannot
	// crowd an older retained copy out of the caller's inventory page.
	const visibleEnvironments = db
		.select({ id: environments.environmentId })
		.from(environments)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(and(eq(projects.organizationId, organizationId), projectIdFilter(projects.projectId)));
	const visiblePostgres = db
		.select({ id: postgres.postgresId })
		.from(postgres)
		.where(inArray(postgres.environmentId, visibleEnvironments));
	const visibleBackups = db
		.select({ id: backups.backupId })
		.from(backups)
		.innerJoin(destinations, eq(backups.destinationId, destinations.destinationId))
		.where(
			and(
				eq(destinations.organizationId, organizationId),
				eq(backups.databaseType, "postgres"),
				inArray(backups.postgresId, visiblePostgres),
			),
		);
	const matches =
		"backupId" in filter
			? eq(recoveryCopies.backupId, filter.backupId)
			: "postgresId" in filter
				? or(
						eq(recoveryCopies.sourcePostgresId, filter.postgresId),
						eq(recoveryCopies.targetPostgresId, filter.postgresId),
					)
				: or(
						inArray(
							recoveryCopies.environmentId,
							db
								.select({ id: environments.environmentId })
								.from(environments)
								.where(eq(environments.projectId, filter.projectId)),
						),
						inArray(
							recoveryCopies.targetPostgresId,
							db
								.select({ id: postgres.postgresId })
								.from(postgres)
								.innerJoin(environments, eq(postgres.environmentId, environments.environmentId))
								.where(eq(environments.projectId, filter.projectId)),
						),
					);
	return await db
		.select({
			...getTableColumns(recoveryCopies),
			// JS Date loses microseconds. Only this exact DB value may form the
			// next cursor; it is stripped from the public item shape by the router.
			cursorCreatedAt: sql<string>`to_char(${recoveryCopies.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
		})
		.from(recoveryCopies)
		.where(
			and(
				eq(recoveryCopies.organizationId, organizationId),
				matches,
				inArray(recoveryCopies.environmentId, visibleEnvironments),
				or(
					isNull(recoveryCopies.sourcePostgresId),
					inArray(recoveryCopies.sourcePostgresId, visiblePostgres),
				),
				or(
					isNull(recoveryCopies.targetPostgresId),
					inArray(recoveryCopies.targetPostgresId, visiblePostgres),
				),
				or(isNull(recoveryCopies.backupId), inArray(recoveryCopies.backupId, visibleBackups)),
				options.cursor &&
					or(
						lt(recoveryCopies.createdAt, sql`${options.cursor.createdAt}::timestamptz`),
						and(
							eq(recoveryCopies.createdAt, sql`${options.cursor.createdAt}::timestamptz`),
							lt(recoveryCopies.recoveryCopyId, options.cursor.id),
						),
					),
			),
		)
		.orderBy(desc(recoveryCopies.createdAt), desc(recoveryCopies.recoveryCopyId))
		.limit(options.limit ?? 100);
}

/** Caller checks both source and target authorization before entering here. */
export async function deleteRecoveryCopy(
	row: RecoveryCopy,
	target: PostgresRow | null,
): Promise<void> {
	if (
		target &&
		(target.postgresId !== row.targetPostgresId || target.postgresId === row.sourcePostgresId)
	) {
		throw preconditionFailed("The recovery target identity could not be verified");
	}
	const state = recoveryCopyState(row);
	if (!["ready", "error", "interrupted", "deleted"].includes(state))
		throw conflict("Wait for the recovery operation to finish before deleting its copy");
	const {
		originAppName,
		originServerId,
		originVolumeName,
		originSwarmNodeId,
		originVolumeCreatedAt,
	} = row;
	if (
		!originAppName ||
		!originVolumeName ||
		!originSwarmNodeId ||
		originVolumeName !== `${originAppName}-data` ||
		originServerId === "" ||
		assertSafeAppName(originAppName) !== originAppName
	) {
		throw preconditionFailed(
			"The original recovery storage location is unknown. Inspect its service and volume before removing this legacy copy manually.",
		);
	}
	if (target && (target.appName !== originAppName || target.serverId !== originServerId)) {
		throw preconditionFailed(
			"The recovery database moved from its recorded storage location. Restore its original placement before deleting the copy, or inspect and remove its resources manually.",
		);
	}
	// The authorized router read can precede a placement edit. Do not use its
	// stale object as evidence that the managed row still matches the origin.
	const currentTarget = target
		? ((await db.query.postgres.findFirst({
				where: eq(postgres.postgresId, target.postgresId),
			})) ?? null)
		: null;
	if (
		currentTarget &&
		(currentTarget.appName !== originAppName || currentTarget.serverId !== originServerId)
	) {
		throw preconditionFailed(
			"The recovery database moved from its recorded storage location. Restore its original placement before deleting the copy, or inspect and remove its resources manually.",
		);
	}
	const [claimed] = await db
		.update(recoveryCopies)
		.set({ status: "deleting", deadline: new Date(Date.now() + RECOVERY_COPY_TIMEOUT_MS) })
		.where(
			and(
				eq(recoveryCopies.recoveryCopyId, row.recoveryCopyId),
				eq(recoveryCopies.status, row.status),
			),
		)
		.returning();
	if (!claimed)
		throw conflict("Another operation changed this recovery copy; refresh and try again");
	try {
		if (originServerId !== null) {
			const server = await db.query.servers.findFirst({
				where: and(
					eq(servers.serverId, originServerId),
					eq(servers.organizationId, row.organizationId),
				),
				columns: { serverId: true },
			});
			if (!server) throw preconditionFailed("The original recovery server is unavailable");
		}
		const origin: RecoveryOrigin = {
			recoveryCopyId: row.recoveryCopyId,
			originServerId,
			originSwarmNodeId,
			originAppName,
			originVolumeName,
			originVolumeCreatedAt,
		};
		const runtime = await inspectRecoveryRuntime(origin);
		if (currentTarget && runtime.serviceExists) {
			await removeDatabase(originAppName, originServerId, "postgres", currentTarget.environmentId, {
				recoveryCopyId: row.recoveryCopyId,
			});
		} else if (runtime.serviceExists) {
			throw conflict("Original recovery resources remain without a verifiable managed service");
		} else if (runtime.volumeExists) {
			await removeOriginalRecoveryVolume(origin);
		}
		// A missing managed row does not prove that its Swarm service or old volume left.
		// Without the row, only verify absence: a reused service name must not be removed.
		const after = await inspectRecoveryRuntime(origin);
		if (after.serviceExists) {
			throw conflict("The original recovery database service still exists");
		}
		if (after.volumeExists)
			throw conflict("The original recovery database data volume still exists");
		await db.transaction(async (tx) => {
			// Release the restrictive target FK only in the same transaction that
			// conditionally removes the original target and finalizes tracking.
			await tx
				.update(recoveryCopies)
				.set({ targetPostgresId: null })
				.where(eq(recoveryCopies.recoveryCopyId, row.recoveryCopyId));
			if (currentTarget) {
				const [deleted] = await tx
					.delete(postgres)
					.where(
						and(
							eq(postgres.postgresId, currentTarget.postgresId),
							eq(postgres.appName, originAppName),
							originServerId === null
								? isNull(postgres.serverId)
								: eq(postgres.serverId, originServerId),
						),
					)
					.returning({ postgresId: postgres.postgresId });
				if (!deleted) {
					const current = await tx.query.postgres.findFirst({
						where: eq(postgres.postgresId, currentTarget.postgresId),
						columns: { postgresId: true },
					});
					if (current) throw conflict("The recovery database changed during deletion");
				}
			}
			await tx
				.update(recoveryCopies)
				.set({ status: "deleted", targetPostgresId: null, finishedAt: new Date(), error: null })
				.where(eq(recoveryCopies.recoveryCopyId, row.recoveryCopyId));
		});
	} catch {
		await db
			.update(recoveryCopies)
			.set({
				status: "error",
				error: "Deletion did not finish. Retry to remove the remaining recovery resources.",
				finishedAt: new Date(),
			})
			.where(eq(recoveryCopies.recoveryCopyId, row.recoveryCopyId));
		throw preconditionFailed(
			"Recovery copy deletion did not finish; retry after checking its service",
		);
	}
}
