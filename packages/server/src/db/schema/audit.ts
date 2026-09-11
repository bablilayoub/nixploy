import { index, pgTable, text } from "drizzle-orm/pg-core";
import { organizations, users } from "./auth";
import { createdAt, idColumn } from "./utils";

/**
 * Org-scoped audit trail: who did what, on which target, when. Written
 * fire-and-forget from key mutations (see modules/audit) and better-auth
 * database hooks (member/invitation changes).
 *
 * `organization_id` is nullable and `on delete set null`: instance-level auth
 * events (a failed login for an account that belongs to no organization,
 * impersonation of such a user) must still be recorded, and deleting an
 * organization must not erase its own trail — `organization_name` keeps the
 * row readable afterwards (security audit 2.9).
 */
export const auditLogs = pgTable(
	"audit_log",
	{
		auditId: idColumn("audit_id"),
		organizationId: text("organization_id").references(() => organizations.id, {
			onDelete: "set null",
		}),
		/** Denormalised org name, preserved when the organization is deleted. */
		organizationName: text("organization_name"),
		/** Null for system actions (crons, reconciler). */
		actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
		actorEmail: text("actor_email"),
		/** Dot-namespaced action, e.g. "project.create", "application.deploy". */
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		targetName: text("target_name"),
		/** Client IP as resolved by the trusted-proxy policy (may be "unknown"). */
		ip: text("ip"),
		/** Raw `User-Agent` header of the request that caused the action. */
		userAgent: text("user_agent"),
		/** Free-form JSON string with extra context (never secrets). */
		metadata: text("metadata"),
		createdAt: createdAt(),
	},
	(table) => [
		index("audit_log_org_created_idx").on(table.organizationId, table.createdAt),
		index("audit_log_org_action_idx").on(table.organizationId, table.action),
		index("audit_log_created_idx").on(table.createdAt),
	],
);
