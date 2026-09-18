import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations, users } from "./auth";
import { projects } from "./project";
import { createdAt, idColumn, updatedAt } from "./utils";

/**
 * Teams: a named set of people, attached to a set of projects.
 *
 * They exist to answer one question an organization role cannot — *which*
 * projects may this person see. A role says what someone can do; a team says
 * where. A contractor is a `deployer` on the two projects their team owns and
 * cannot see that the others exist.
 *
 * Only members whose `project_scope` is `teams` are constrained by them
 * (`member.project_scope`, default `organization`), so every existing
 * organization keeps behaving exactly as it did until someone opts a member in.
 */
export const teams = pgTable(
	"team",
	{
		teamId: idColumn("team_id"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [uniqueIndex("team_org_name_unique").on(table.organizationId, table.name)],
);

/** Who is in a team. */
export const teamMembers = pgTable(
	"team_member",
	{
		teamId: text("team_id")
			.notNull()
			.references(() => teams.teamId, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.teamId, table.userId] }),
		index("team_member_user_idx").on(table.userId),
	],
);

/**
 * Which projects a team may reach.
 *
 * `on delete cascade` on both sides: deleting a project must not leave a row
 * that grants access to an id a later project could reuse.
 */
export const teamProjects = pgTable(
	"team_project",
	{
		teamId: text("team_id")
			.notNull()
			.references(() => teams.teamId, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.projectId, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.teamId, table.projectId] }),
		index("team_project_project_idx").on(table.projectId),
	],
);

export const teamsRelations = relations(teams, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [teams.organizationId],
		references: [organizations.id],
	}),
	members: many(teamMembers),
	projects: many(teamProjects),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
	team: one(teams, { fields: [teamMembers.teamId], references: [teams.teamId] }),
	user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const teamProjectsRelations = relations(teamProjects, ({ one }) => ({
	team: one(teams, { fields: [teamProjects.teamId], references: [teams.teamId] }),
	project: one(projects, {
		fields: [teamProjects.projectId],
		references: [projects.projectId],
	}),
}));
