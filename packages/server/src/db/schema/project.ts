import { relations } from "drizzle-orm";
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { organizations } from "./auth";
import { createdAt, idColumn } from "./utils";

export const projects = pgTable(
	"project",
	{
		projectId: idColumn("project_id"),
		name: text("name").notNull(),
		description: text("description"),
		/** Project-level env vars, inherited by all environments/services below. */
		env: encryptedText("env"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [index("project_organization_id_idx").on(table.organizationId)],
);

export const environments = pgTable(
	"environment",
	{
		environmentId: idColumn("environment_id"),
		name: text("name").notNull(),
		description: text("description"),
		/** Environment-level env vars, override project-level ones. */
		env: encryptedText("env"),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.projectId, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [index("environment_project_id_idx").on(table.projectId)],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [projects.organizationId],
		references: [organizations.id],
	}),
	environments: many(environments),
}));

export const environmentsRelations = relations(environments, ({ one }) => ({
	project: one(projects, {
		fields: [environments.projectId],
		references: [projects.projectId],
	}),
}));

export const insertProjectSchema = createInsertSchema(projects);
export const selectProjectSchema = createSelectSchema(projects);
export const insertEnvironmentSchema = createInsertSchema(environments);
export const selectEnvironmentSchema = createSelectSchema(environments);
