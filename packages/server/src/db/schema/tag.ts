import { relations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organizations } from "./auth";
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

export const tagsRelations = relations(tags, ({ one }) => ({
	organization: one(organizations, {
		fields: [tags.organizationId],
		references: [organizations.id],
	}),
}));

export const insertTagSchema = createInsertSchema(tags);
export const selectTagSchema = createSelectSchema(tags);
