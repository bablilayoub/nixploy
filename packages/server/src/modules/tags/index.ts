import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
	applicationTags,
	composeTags,
	mariadb,
	mariadbTags,
	mongo,
	mongoTags,
	mysql,
	mysqlTags,
	postgres,
	postgresTags,
	redis,
	redisTags,
	tags,
} from "../../db/schema";
import { assertApplicationAccess } from "../application";
import { findComposeForOrg } from "../compose/service";

export type TaggableServiceType =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis";

async function assertTagInOrg(tagId: string, organizationId: string) {
	const tag = await db.query.tags.findFirst({ where: eq(tags.tagId, tagId) });
	if (!tag || tag.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
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
		throw new TRPCError({ code: "BAD_REQUEST", message: "Name is required" });
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

async function assertServiceInOrg(
	type: TaggableServiceType,
	serviceId: string,
	organizationId: string,
) {
	if (type === "application") {
		await assertApplicationAccess(serviceId, organizationId);
		return;
	}
	if (type === "compose") {
		await findComposeForOrg(serviceId, organizationId);
		return;
	}

	const withEnv = { environment: { with: { project: true } } } as const;
	const row =
		type === "postgres"
			? await db.query.postgres.findFirst({
					where: eq(postgres.postgresId, serviceId),
					with: withEnv,
				})
			: type === "mysql"
				? await db.query.mysql.findFirst({
						where: eq(mysql.mysqlId, serviceId),
						with: withEnv,
					})
				: type === "mariadb"
					? await db.query.mariadb.findFirst({
							where: eq(mariadb.mariadbId, serviceId),
							with: withEnv,
						})
					: type === "mongo"
						? await db.query.mongo.findFirst({
								where: eq(mongo.mongoId, serviceId),
								with: withEnv,
							})
						: await db.query.redis.findFirst({
								where: eq(redis.redisId, serviceId),
								with: withEnv,
							});

	if (!row || row.environment.project.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
	}
}

export async function setServiceTags(
	organizationId: string,
	type: TaggableServiceType,
	serviceId: string,
	tagIds: string[],
) {
	await assertServiceInOrg(type, serviceId, organizationId);
	if (tagIds.length > 0) {
		const owned = await db.query.tags.findMany({
			where: and(eq(tags.organizationId, organizationId), inArray(tags.tagId, tagIds)),
		});
		if (owned.length !== tagIds.length) {
			throw new TRPCError({ code: "BAD_REQUEST", message: "One or more tags are invalid" });
		}
	}

	if (type === "application") {
		await db.delete(applicationTags).where(eq(applicationTags.applicationId, serviceId));
		if (tagIds.length) {
			await db
				.insert(applicationTags)
				.values(tagIds.map((tagId) => ({ applicationId: serviceId, tagId })));
		}
	} else if (type === "compose") {
		await db.delete(composeTags).where(eq(composeTags.composeId, serviceId));
		if (tagIds.length) {
			await db.insert(composeTags).values(tagIds.map((tagId) => ({ composeId: serviceId, tagId })));
		}
	} else if (type === "postgres") {
		await db.delete(postgresTags).where(eq(postgresTags.postgresId, serviceId));
		if (tagIds.length) {
			await db
				.insert(postgresTags)
				.values(tagIds.map((tagId) => ({ postgresId: serviceId, tagId })));
		}
	} else if (type === "mysql") {
		await db.delete(mysqlTags).where(eq(mysqlTags.mysqlId, serviceId));
		if (tagIds.length) {
			await db.insert(mysqlTags).values(tagIds.map((tagId) => ({ mysqlId: serviceId, tagId })));
		}
	} else if (type === "mariadb") {
		await db.delete(mariadbTags).where(eq(mariadbTags.mariadbId, serviceId));
		if (tagIds.length) {
			await db.insert(mariadbTags).values(tagIds.map((tagId) => ({ mariadbId: serviceId, tagId })));
		}
	} else if (type === "mongo") {
		await db.delete(mongoTags).where(eq(mongoTags.mongoId, serviceId));
		if (tagIds.length) {
			await db.insert(mongoTags).values(tagIds.map((tagId) => ({ mongoId: serviceId, tagId })));
		}
	} else {
		await db.delete(redisTags).where(eq(redisTags.redisId, serviceId));
		if (tagIds.length) {
			await db.insert(redisTags).values(tagIds.map((tagId) => ({ redisId: serviceId, tagId })));
		}
	}
	return { type, serviceId, tagIds };
}

export async function tagsForServices(
	organizationId: string,
	services: Array<{ type: TaggableServiceType; id: string }>,
) {
	const byKey: Record<string, Array<{ tagId: string; name: string; color: string }>> = {};
	const appIds = services.filter((s) => s.type === "application").map((s) => s.id);
	const composeIds = services.filter((s) => s.type === "compose").map((s) => s.id);

	if (appIds.length) {
		const rows = await db
			.select({
				applicationId: applicationTags.applicationId,
				tagId: tags.tagId,
				name: tags.name,
				color: tags.color,
			})
			.from(applicationTags)
			.innerJoin(tags, eq(applicationTags.tagId, tags.tagId))
			.where(
				and(
					eq(tags.organizationId, organizationId),
					inArray(applicationTags.applicationId, appIds),
				),
			);
		for (const row of rows) {
			const key = `application:${row.applicationId}`;
			const list = byKey[key] ?? [];
			list.push({ tagId: row.tagId, name: row.name, color: row.color });
			byKey[key] = list;
		}
	}
	if (composeIds.length) {
		const rows = await db
			.select({
				composeId: composeTags.composeId,
				tagId: tags.tagId,
				name: tags.name,
				color: tags.color,
			})
			.from(composeTags)
			.innerJoin(tags, eq(composeTags.tagId, tags.tagId))
			.where(
				and(eq(tags.organizationId, organizationId), inArray(composeTags.composeId, composeIds)),
			);
		for (const row of rows) {
			const key = `compose:${row.composeId}`;
			const list = byKey[key] ?? [];
			list.push({ tagId: row.tagId, name: row.name, color: row.color });
			byKey[key] = list;
		}
	}

	const dbKinds = [
		{
			type: "postgres" as const,
			join: postgresTags,
			idCol: postgresTags.postgresId,
			ids: services.filter((s) => s.type === "postgres").map((s) => s.id),
		},
		{
			type: "mysql" as const,
			join: mysqlTags,
			idCol: mysqlTags.mysqlId,
			ids: services.filter((s) => s.type === "mysql").map((s) => s.id),
		},
		{
			type: "mariadb" as const,
			join: mariadbTags,
			idCol: mariadbTags.mariadbId,
			ids: services.filter((s) => s.type === "mariadb").map((s) => s.id),
		},
		{
			type: "mongo" as const,
			join: mongoTags,
			idCol: mongoTags.mongoId,
			ids: services.filter((s) => s.type === "mongo").map((s) => s.id),
		},
		{
			type: "redis" as const,
			join: redisTags,
			idCol: redisTags.redisId,
			ids: services.filter((s) => s.type === "redis").map((s) => s.id),
		},
	];

	for (const kind of dbKinds) {
		if (!kind.ids.length) continue;
		const rows = await db
			.select({
				serviceId: kind.idCol,
				tagId: tags.tagId,
				name: tags.name,
				color: tags.color,
			})
			.from(kind.join)
			.innerJoin(tags, eq(kind.join.tagId, tags.tagId))
			.where(and(eq(tags.organizationId, organizationId), inArray(kind.idCol, kind.ids)));
		for (const row of rows) {
			const key = `${kind.type}:${row.serviceId}`;
			const list = byKey[key] ?? [];
			list.push({ tagId: row.tagId, name: row.name, color: row.color });
			byKey[key] = list;
		}
	}

	return byKey;
}
