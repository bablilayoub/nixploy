import { relations } from "drizzle-orm";
import { boolean, pgTable, text, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { createdAt, idColumn } from "./utils";

/** Traefik redirectRegex middleware for an application. */
export const redirects = pgTable(
	"redirect",
	{
		redirectId: idColumn("redirect_id"),
		regex: text("regex").notNull(),
		replacement: text("replacement").notNull(),
		permanent: boolean("permanent").notNull().default(false),
		applicationId: text("application_id")
			.notNull()
			.references(() => applications.applicationId, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [unique("redirect_app_regex_unique").on(table.applicationId, table.regex)],
);

export const redirectsRelations = relations(redirects, ({ one }) => ({
	application: one(applications, {
		fields: [redirects.applicationId],
		references: [applications.applicationId],
	}),
}));

export const insertRedirectSchema = createInsertSchema(redirects);
export const selectRedirectSchema = createSelectSchema(redirects);
