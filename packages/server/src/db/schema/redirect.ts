import { relations, sql } from "drizzle-orm";
import { boolean, check, pgTable, text, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { compose } from "./compose";
import { createdAt, idColumn } from "./utils";

/**
 * Traefik redirectRegex middleware for an application **or** one service of a
 * compose stack. Exactly one parent is set (CHECK `redirect_one_parent`):
 * compose rows also carry `serviceName`, because each compose service gets its
 * own Traefik config file.
 */
export const redirects = pgTable(
	"redirect",
	{
		redirectId: idColumn("redirect_id"),
		regex: text("regex").notNull(),
		replacement: text("replacement").notNull(),
		permanent: boolean("permanent").notNull().default(false),
		applicationId: text("application_id").references(() => applications.applicationId, {
			onDelete: "cascade",
		}),
		composeId: text("compose_id").references(() => compose.composeId, {
			onDelete: "cascade",
		}),
		/** Compose only: which compose-file service the redirect applies to. */
		serviceName: text("service_name"),
		createdAt: createdAt(),
	},
	(table) => [
		unique("redirect_app_regex_unique").on(table.applicationId, table.regex),
		unique("redirect_compose_regex_unique").on(table.composeId, table.serviceName, table.regex),
		check(
			"redirect_one_parent",
			sql`(${table.applicationId} is not null)::int + (${table.composeId} is not null)::int = 1`,
		),
		check(
			"redirect_compose_service_name",
			sql`${table.composeId} is null or ${table.serviceName} is not null`,
		),
	],
);

export const redirectsRelations = relations(redirects, ({ one }) => ({
	application: one(applications, {
		fields: [redirects.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [redirects.composeId],
		references: [compose.composeId],
	}),
}));

export const insertRedirectSchema = createInsertSchema(redirects);
export const selectRedirectSchema = createSelectSchema(redirects);
