import { eq, sql } from "drizzle-orm";
import { type DbExecutor, db } from "../../db";
import { organizations } from "../../db/schema/auth";
import { organizationEnvironments } from "../../db/schema/configuration-release";
import { notFound, preconditionFailed } from "../errors";

function metadataObject(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export function legacyOrganizationEnv(metadata: string | null): string | null {
	const value = metadataObject(metadata);
	if (!value || !Object.hasOwn(value, "env")) return null;
	if (typeof value.env !== "string") {
		throw preconditionFailed("Organization variables need migration: the legacy value is invalid");
	}
	return value.env;
}

/** New readers never silently ignore a legacy writer's plaintext value. */
export async function loadOrganizationEnvironment(
	organizationId: string,
	executor: DbExecutor = db,
): Promise<string> {
	const [org] = await executor
		.select({ metadata: organizations.metadata })
		.from(organizations)
		.where(eq(organizations.id, organizationId));
	if (!org) throw notFound("Organization not found");
	if (legacyOrganizationEnv(org.metadata) !== null) {
		throw preconditionFailed(
			"Organization variables need the encrypted-storage upgrade before use",
		);
	}
	const [row] = await executor
		.select({ env: organizationEnvironments.env })
		.from(organizationEnvironments)
		.where(eq(organizationEnvironments.organizationId, organizationId));
	return row?.env ?? "";
}

export async function saveOrganizationEnvironment(
	organizationId: string,
	env: string,
	executor: DbExecutor = db,
): Promise<void> {
	await executor.transaction(async (tx) => {
		await tx.execute(sql`select id from organization where id = ${organizationId} for update`);
		await loadOrganizationEnvironment(organizationId, tx);
		await tx
			.insert(organizationEnvironments)
			.values({ organizationId, env })
			.onConflictDoUpdate({
				target: organizationEnvironments.organizationId,
				set: { env, updatedAt: new Date() },
			});
	});
}

/** Run before either HTTP or the deployment worker accepts work. Never logs values. */
export async function migrateOrganizationEnvironments(): Promise<{ migrated: number }> {
	return await db.transaction(async (tx) => {
		const rows = await tx.select().from(organizations).orderBy(organizations.id).for("update");
		let migrated = 0;
		for (const org of rows) {
			const legacy = legacyOrganizationEnv(org.metadata);
			if (legacy === null) continue;
			const [existing] = await tx
				.select()
				.from(organizationEnvironments)
				.where(eq(organizationEnvironments.organizationId, org.id));
			if (existing && existing.env !== legacy) {
				throw preconditionFailed(
					"Organization variable migration found conflicting legacy and encrypted values; stop older writers and reconcile before retrying",
				);
			}
			if (!existing) {
				await tx.insert(organizationEnvironments).values({ organizationId: org.id, env: legacy });
			}
			const metadata = metadataObject(org.metadata) as Record<string, unknown>;
			delete metadata.env;
			await tx
				.update(organizations)
				.set({ metadata: JSON.stringify(metadata) })
				.where(eq(organizations.id, org.id));
			migrated++;
		}
		return { migrated };
	});
}
