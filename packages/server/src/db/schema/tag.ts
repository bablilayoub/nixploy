import { relations } from "drizzle-orm";
import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { organizations } from "./auth";
import { compose } from "./compose";
import { mariadb, mongo, mysql, postgres, redis } from "./database";
import { createdAt, idColumn } from "./utils";

/** Free-form labels attachable to services for filtering/organization. */
export const tags = pgTable("tag", {
	tagId: idColumn("tag_id"),
	name: text("name").notNull(),
	color: text("color").notNull().default("#3b82f6"),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	createdAt: createdAt(),
});

export const applicationTags = pgTable(
	"application_tag",
	{
		applicationId: text("application_id")
			.notNull()
			.references(() => applications.applicationId, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.tagId, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.applicationId, table.tagId] })],
);

export const composeTags = pgTable(
	"compose_tag",
	{
		composeId: text("compose_id")
			.notNull()
			.references(() => compose.composeId, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.tagId, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.composeId, table.tagId] })],
);

export const postgresTags = pgTable(
	"postgres_tag",
	{
		postgresId: text("postgres_id")
			.notNull()
			.references(() => postgres.postgresId, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.tagId, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.postgresId, table.tagId] })],
);

export const mysqlTags = pgTable(
	"mysql_tag",
	{
		mysqlId: text("mysql_id")
			.notNull()
			.references(() => mysql.mysqlId, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.tagId, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.mysqlId, table.tagId] })],
);

export const mariadbTags = pgTable(
	"mariadb_tag",
	{
		mariadbId: text("mariadb_id")
			.notNull()
			.references(() => mariadb.mariadbId, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.tagId, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.mariadbId, table.tagId] })],
);

export const mongoTags = pgTable(
	"mongo_tag",
	{
		mongoId: text("mongo_id")
			.notNull()
			.references(() => mongo.mongoId, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.tagId, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.mongoId, table.tagId] })],
);

export const redisTags = pgTable(
	"redis_tag",
	{
		redisId: text("redis_id")
			.notNull()
			.references(() => redis.redisId, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.tagId, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.redisId, table.tagId] })],
);

export const tagsRelations = relations(tags, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [tags.organizationId],
		references: [organizations.id],
	}),
	applicationTags: many(applicationTags),
	composeTags: many(composeTags),
}));

export const applicationTagsRelations = relations(applicationTags, ({ one }) => ({
	application: one(applications, {
		fields: [applicationTags.applicationId],
		references: [applications.applicationId],
	}),
	tag: one(tags, {
		fields: [applicationTags.tagId],
		references: [tags.tagId],
	}),
}));

export const composeTagsRelations = relations(composeTags, ({ one }) => ({
	compose: one(compose, {
		fields: [composeTags.composeId],
		references: [compose.composeId],
	}),
	tag: one(tags, {
		fields: [composeTags.tagId],
		references: [tags.tagId],
	}),
}));

export const insertTagSchema = createInsertSchema(tags);
export const selectTagSchema = createSelectSchema(tags);
