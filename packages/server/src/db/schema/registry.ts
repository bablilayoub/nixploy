import { relations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { organizations } from "./auth";
import { registryType } from "./enums";
import { createdAt, idColumn } from "./utils";

/** Docker registry credentials used to pull private images / push builds. */
export const registry = pgTable("registry", {
	registryId: idColumn("registry_id"),
	registryName: text("registry_name").notNull(),
	username: text("username").notNull(),
	password: encryptedText("password").notNull(),
	registryUrl: text("registry_url").notNull().default(""),
	registryType: registryType("registry_type").notNull().default("cloud"),
	imagePrefix: text("image_prefix"),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	createdAt: createdAt(),
});

export const registryRelations = relations(registry, ({ one }) => ({
	organization: one(organizations, {
		fields: [registry.organizationId],
		references: [organizations.id],
	}),
}));

export const insertRegistrySchema = createInsertSchema(registry);
export const selectRegistrySchema = createSelectSchema(registry);
