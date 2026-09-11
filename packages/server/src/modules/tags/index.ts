import { and, eq, inArray } from "drizzle-orm";
import { type DbExecutor, db } from "../../db";
import { tags } from "../../db/schema";
import { badRequest, notFound } from "../errors";
import { SERVICE_REGISTRY, type ServiceKind } from "../services/registry";

async function assertTagInOrg(tagId: string, organizationId: string) {
	const tag = await db.query.tags.findFirst({ where: eq(tags.tagId, tagId) });
	if (!tag || tag.organizationId !== organizationId) {
		throw notFound("Tag not found");
	}
	return tag;
}

export async function listTags(organizationId: string) {
	return db.query.tags.findMany({
		where: eq(tags.organizationId, organizationId),
		orderBy: (table, { asc }) => [asc(table.name)],
	});
}

export async function createTag(organizationId: string, input: { name: string; color?: string }) {
	const name = input.name.trim();
	if (!name) {
		throw badRequest("Name is required");
	}
	const [row] = await db
		.insert(tags)
		.values({
			name,
			color: input.color ?? "#3b82f6",
			organizationId,
		})
		.returning();
	return row;
}

export async function updateTag(
	tagId: string,
	organizationId: string,
	input: { name?: string; color?: string },
) {
	await assertTagInOrg(tagId, organizationId);
	const [row] = await db
		.update(tags)
		.set({
			...(input.name !== undefined ? { name: input.name.trim() } : {}),
			...(input.color !== undefined ? { color: input.color } : {}),
		})
		.where(eq(tags.tagId, tagId))
		.returning();
	return row;
}

export async function deleteTag(tagId: string, organizationId: string) {
	await assertTagInOrg(tagId, organizationId);
	await db.delete(tags).where(eq(tags.tagId, tagId));
	return { tagId };
}

/**
 * Verify the service exists and belongs to the caller's organization. The
 * message is deliberately the same for every kind and for "does not exist" so
 * a tag mutation cannot be used to probe ids across tenants.
 */
async function assertServiceInOrg(
	type: ServiceKind,
	serviceId: string,
	organizationId: string,
): Promise<void> {
	const row = await SERVICE_REGISTRY[type].module.findTenancy(serviceId);
	if (!row || row.organizationId !== organizationId) {
		throw notFound("Service not found");
	}
}

/**
 * Replace a service's tag set. The delete + insert run in one transaction so
 * a crash between them cannot leave the service with no tags at all.
 */
export async function setServiceTags(
	organizationId: string,
	type: ServiceKind,
	serviceId: string,
	tagIds: string[],
	executor: DbExecutor = db,
) {
	await assertServiceInOrg(type, serviceId, organizationId);
	if (tagIds.length > 0) {
		const owned = await db.query.tags.findMany({
			where: and(eq(tags.organizationId, organizationId), inArray(tags.tagId, tagIds)),
		});
		if (owned.length !== tagIds.length) {
			throw badRequest("One or more tags are invalid");
		}
	}

	await executor.transaction(async (tx) => {
		await SERVICE_REGISTRY[type].module.setTags(serviceId, tagIds, tx);
	});
	return { type, serviceId, tagIds };
}

export async function tagsForServices(
	organizationId: string,
	services: Array<{ type: ServiceKind; id: string }>,
) {
	const byKey: Record<string, Array<{ tagId: string; name: string; color: string }>> = {};
	const byKind = new Map<ServiceKind, string[]>();
	for (const service of services) {
		const ids = byKind.get(service.type) ?? [];
		ids.push(service.id);
		byKind.set(service.type, ids);
	}

	for (const [kind, ids] of byKind) {
		const rows = await SERVICE_REGISTRY[kind].module.listTagAssignments(organizationId, ids);
		for (const row of rows) {
			const key = `${kind}:${row.serviceId}`;
			const list = byKey[key] ?? [];
			list.push({ tagId: row.tagId, name: row.name, color: row.color });
			byKey[key] = list;
		}
	}

	return byKey;
}
