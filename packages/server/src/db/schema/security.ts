import { relations, sql } from "drizzle-orm";
import { check, pgTable, text, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { applications } from "./application";
import { compose } from "./compose";
import { createdAt, idColumn } from "./utils";

/**
 * HTTP basic-auth credentials protecting the Traefik router of an application
 * **or** one service of a compose stack. Exactly one parent is set (CHECK
 * `security_one_parent`); compose rows also carry `serviceName`.
 */
export const security = pgTable(
	"security",
	{
		securityId: idColumn("security_id"),
		username: text("username").notNull(),
		/** bcrypt-hashed password (Traefik basicAuth users file format). */
		password: encryptedText("password").notNull(),
		applicationId: text("application_id").references(() => applications.applicationId, {
			onDelete: "cascade",
		}),
		composeId: text("compose_id").references(() => compose.composeId, {
			onDelete: "cascade",
		}),
		/** Compose only: which compose-file service the credentials protect. */
		serviceName: text("service_name"),
		createdAt: createdAt(),
	},
	(table) => [
		unique("security_app_username_unique").on(table.applicationId, table.username),
		unique("security_compose_username_unique").on(
			table.composeId,
			table.serviceName,
			table.username,
		),
		check(
			"security_one_parent",
			sql`(${table.applicationId} is not null)::int + (${table.composeId} is not null)::int = 1`,
		),
		check(
			"security_compose_service_name",
			sql`${table.composeId} is null or ${table.serviceName} is not null`,
		),
	],
);

export const securityRelations = relations(security, ({ one }) => ({
	application: one(applications, {
		fields: [security.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [security.composeId],
		references: [compose.composeId],
	}),
}));

export const insertSecuritySchema = createInsertSchema(security);
export const selectSecuritySchema = createSelectSchema(security);
