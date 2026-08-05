import { index, pgTable, text } from "drizzle-orm/pg-core";
import { organizations, users } from "./auth";
import { createdAt, idColumn } from "./utils";

/**
 * Org-scoped audit trail: who did what, on which target, when. Written
 * fire-and-forget from key mutations (see modules/audit) and better-auth
 * database hooks (member/invitation changes).
 */
export const auditLogs = pgTable(
	"audit_log",
	{
		auditId: idColumn("audit_id"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		/** Null for system actions (crons, reconciler). */
		actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
		actorEmail: text("actor_email"),
		/** Dot-namespaced action, e.g. "project.create", "application.deploy". */
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		targetName: text("target_name"),
		/** Free-form JSON string with extra context (never secrets). */
		metadata: text("metadata"),
		createdAt: createdAt(),
	},
	(table) => [
		index("audit_log_org_created_idx").on(table.organizationId, table.createdAt),
		index("audit_log_org_action_idx").on(table.organizationId, table.action),
	],
);
