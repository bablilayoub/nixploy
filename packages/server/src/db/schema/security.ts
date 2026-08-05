import { relations } from "drizzle-orm";
import { pgTable, text, unique } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { applications } from "./application";
import { createdAt, idColumn } from "./utils";

/** HTTP basic-auth credentials protecting an application's Traefik router. */
export const security = pgTable(
	"security",
	{
		securityId: idColumn("security_id"),
		username: text("username").notNull(),
		/** bcrypt-hashed password (Traefik basicAuth users file format). */
		password: encryptedText("password").notNull(),
		applicationId: text("application_id")
			.notNull()
			.references(() => applications.applicationId, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [unique("security_app_username_unique").on(table.applicationId, table.username)],
);

export const securityRelations = relations(security, ({ one }) => ({
	application: one(applications, {
		fields: [security.applicationId],
		references: [applications.applicationId],
	}),
}));

export const insertSecuritySchema = createInsertSchema(security);
export const selectSecuritySchema = createSelectSchema(security);
