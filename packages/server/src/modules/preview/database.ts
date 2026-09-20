import { eq } from "drizzle-orm";
import { db } from "../../db";
import { databaseLogicals, previewDeployments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { DATABASE_CONFIGS } from "../databases/engine";
import {
	buildCreateLogicalCommand,
	buildDropLogicalCommand,
	buildLogicalConnectionUrl,
	findDatabaseContainerId,
	generateLogicalPassword,
	LOGICAL_DATABASE_KINDS,
	type LogicalDatabaseKind,
	runLogicalCommand,
	supportsLogicalDatabases,
} from "../databases/logical";
import { badRequest, notFound } from "../errors";
import { SERVICE_REGISTRY } from "../services/registry";
import type { PreviewParent } from "./parent";

/**
 * One logical database per preview.
 *
 * A preview that shares production's `DATABASE_URL` is a preview of the
 * front-end only; one that gets its own database — created on the parent's
 * chosen database service, seeded once, dropped with the preview — is an
 * environment. The database is a row in `database_logical` like one created
 * by hand, so it shows on the database's own page and is deletable there if
 * a preview ever leaves it behind.
 */

const log = createLogger("preview-database");

/** The env key the preview receives; the parent's own `DATABASE_URL` is overridden by it. */
export const PREVIEW_DATABASE_ENV_KEY = "DATABASE_URL";

const IDENTIFIER_MAX = 63;

export interface PreviewDatabaseIdentifiers {
	name: string;
	username: string;
}

/**
 * `shop-a1b2c3-pr-12` → database `shop_a1b2c3_pr_12`, user
 * `shop_a1b2c3_pr_12_u`: the preview's own service name in the engines'
 * identifier alphabet, so a database on the server is traceable to the
 * preview that owns it by eye.
 */
export function previewDatabaseIdentifiers(previewAppName: string): PreviewDatabaseIdentifiers {
	let base = previewAppName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
	if (!/^[a-z_]/.test(base)) base = `p_${base}`;
	const name = base.slice(0, IDENTIFIER_MAX);
	const username = `${base.slice(0, IDENTIFIER_MAX - 2)}_u`;
	return { name, username };
}

export const isLogicalKind = (value: string | null | undefined): value is LogicalDatabaseKind =>
	Boolean(value) && (LOGICAL_DATABASE_KINDS as readonly string[]).includes(value as string);

/** The columns this module reads off a database service row, whatever the engine. */
export interface LogicalServiceRow {
	name: string;
	appName: string;
	serverId: string | null;
	environmentId: string;
}

/**
 * The registry module of one logical-capable engine, narrowed to the row
 * shape above. Indexing the registry with a union kind gives an intersection
 * of the four row types, which no row satisfies; the four engines agree on
 * these columns.
 */
export const logicalServiceModule = (kind: LogicalDatabaseKind) =>
	SERVICE_REGISTRY[kind].module as unknown as {
		rowId(row: LogicalServiceRow): string;
		findById(serviceId: string): Promise<LogicalServiceRow | undefined>;
		listByEnvironment(environmentId: string): Promise<LogicalServiceRow[]>;
	};

/**
 * Validate a parent's `previewDatabase*` setting: both set or both null, an
 * engine that has logical databases, and a service in the parent's own
 * environment — a preview reaches its database over the environment overlay.
 */
export async function assertPreviewDatabaseTarget(
	input: { previewDatabaseKind?: string | null; previewDatabaseId?: string | null },
	environmentId: string,
): Promise<void> {
	const kind = input.previewDatabaseKind ?? null;
	const id = input.previewDatabaseId ?? null;
	if (!kind && !id) return;
	if (!kind || !id) {
		throw badRequest("previewDatabaseKind and previewDatabaseId go together");
	}
	if (!isLogicalKind(kind) || !supportsLogicalDatabases(kind)) {
		throw badRequest(`${kind} has no per-preview databases (postgres, mysql, mariadb or mongo)`);
	}
	const row = await logicalServiceModule(kind).findById(id);
	if (!row) throw notFound("Preview database service not found");
	if (row.environmentId !== environmentId) {
		throw badRequest("The preview database must live in the same environment as the service");
	}
}

async function loadTarget(parent: PreviewParent) {
	const kind = parent.previewDatabaseKind;
	if (!isLogicalKind(kind) || !parent.previewDatabaseId) return null;
	const row = await logicalServiceModule(kind).findById(parent.previewDatabaseId);
	if (!row) {
		throw badRequest(
			`The database service configured for previews of "${parent.name}" no longer exists`,
		);
	}
	return { kind, row };
}

/**
 * Create the preview's database if the parent asks for one and it does not
 * exist yet (a redeploy of a preview that was created before the setting,
 * or approved after it, provisions on the way). Returns the logical id.
 */
export async function ensurePreviewDatabase(
	parent: PreviewParent,
	preview: {
		previewDeploymentId: string;
		appName: string;
		previewDatabaseLogicalId: string | null;
	},
): Promise<string | null> {
	if (preview.previewDatabaseLogicalId) return preview.previewDatabaseLogicalId;
	const target = await loadTarget(parent);
	if (!target) return null;
	const { kind, row } = target;
	const { name, username } = previewDatabaseIdentifiers(preview.appName);
	const password = generateLogicalPassword();
	const containerId = await findDatabaseContainerId(row.appName, row.serverId);

	// Row first, engine second: a crash in between leaves a visible,
	// deletable row rather than an invisible database (same order the
	// database router uses).
	const [logical] = await db
		.insert(databaseLogicals)
		.values({
			serviceType: kind,
			name,
			username,
			password,
			[`${kind}Id`]: logicalServiceModule(kind).rowId(row),
		})
		.returning();
	if (!logical) throw new Error("Failed to record the preview database");
	try {
		await runLogicalCommand(
			containerId,
			row.serverId,
			buildCreateLogicalCommand(kind, { name, username, password }),
		);
	} catch (error) {
		await db
			.delete(databaseLogicals)
			.where(eq(databaseLogicals.databaseLogicalId, logical.databaseLogicalId))
			.catch(() => {});
		throw badRequest(
			`Could not create the preview database "${name}" on ${row.name}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	await db
		.update(previewDeployments)
		.set({
			previewDatabaseLogicalId: logical.databaseLogicalId,
			previewSeedPending: Boolean(parent.previewSeedCommand?.trim()),
		})
		.where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId));
	return logical.databaseLogicalId;
}

/** `DATABASE_URL=…` for the preview's database, or null when it has none. */
export async function previewDatabaseEnv(preview: {
	previewDatabaseLogicalId: string | null;
}): Promise<string | null> {
	if (!preview.previewDatabaseLogicalId) return null;
	const logical = await db.query.databaseLogicals.findFirst({
		where: eq(databaseLogicals.databaseLogicalId, preview.previewDatabaseLogicalId),
	});
	if (!logical) return null;
	const kind = logical.serviceType;
	if (!isLogicalKind(kind)) return null;
	const rowId = logical[`${kind}Id`];
	if (!rowId) return null;
	const row = await logicalServiceModule(kind).findById(rowId);
	if (!row) return null;
	const url = buildLogicalConnectionUrl(
		kind,
		{ name: logical.name, username: logical.username, password: logical.password },
		row.appName,
		DATABASE_CONFIGS[kind].internalPort,
	);
	return `${PREVIEW_DATABASE_ENV_KEY}=${url}`;
}

/** Drop the preview's database and forget it. Best effort: a database left behind is still listed on its service. */
export async function dropPreviewDatabase(preview: {
	previewDeploymentId: string;
	previewDatabaseLogicalId: string | null;
}): Promise<void> {
	if (!preview.previewDatabaseLogicalId) return;
	const logical = await db.query.databaseLogicals.findFirst({
		where: eq(databaseLogicals.databaseLogicalId, preview.previewDatabaseLogicalId),
	});
	if (!logical) return;
	try {
		const kind = logical.serviceType;
		if (!isLogicalKind(kind)) return;
		const rowId = logical[`${kind}Id`];
		const row = rowId ? await logicalServiceModule(kind).findById(rowId) : undefined;
		if (row) {
			const containerId = await findDatabaseContainerId(row.appName, row.serverId);
			await runLogicalCommand(
				containerId,
				row.serverId,
				buildDropLogicalCommand(kind, { name: logical.name, username: logical.username }),
			);
		}
		await db
			.delete(databaseLogicals)
			.where(eq(databaseLogicals.databaseLogicalId, logical.databaseLogicalId));
	} catch (error) {
		log.warn("Could not drop the preview database; it stays listed on its service", {
			previewDeploymentId: preview.previewDeploymentId,
			database: logical.name,
			error: describeErrorWithCause(error),
		});
	}
}
