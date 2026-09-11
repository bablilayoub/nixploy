import { relations } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { users } from "./auth";
import { compose } from "./compose";
import { scheduleType, shellType } from "./enums";
import { servers } from "./server";
import { createdAt, idColumn } from "./utils";

/** A cron-scheduled shell command run in a service container or on a server. */
export const schedules = pgTable("schedule", {
	scheduleId: idColumn("schedule_id"),
	name: text("name").notNull(),
	cronExpression: text("cron_expression").notNull(),
	shellType: shellType("shell_type").notNull().default("bash"),
	command: text("command").notNull(),
	/** Inline script written to a file and executed instead of `command`. */
	script: text("script"),
	enabled: boolean("enabled").notNull().default(true),
	scheduleType: scheduleType("schedule_type").notNull(),
	appName: text("app_name"),
	applicationId: text("application_id").references(() => applications.applicationId, {
		onDelete: "cascade",
	}),
	composeId: text("compose_id").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "cascade",
	}),
	userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
	/**
	 * Written at the START of every run (`modules/schedules#runSchedule`), which
	 * is what makes the boot catch-up replay idempotent: a process that dies
	 * mid-run still moved the marker, so the next boot does not replay it
	 * forever. Null for rows that never ran (and for rows older than 0023).
	 */
	lastRunAt: timestamp("last_run_at", { withTimezone: true }),
	createdAt: createdAt(),
});

export const schedulesRelations = relations(schedules, ({ one }) => ({
	application: one(applications, {
		fields: [schedules.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [schedules.composeId],
		references: [compose.composeId],
	}),
	server: one(servers, {
		fields: [schedules.serverId],
		references: [servers.serverId],
	}),
	user: one(users, {
		fields: [schedules.userId],
		references: [users.id],
	}),
}));

export const insertScheduleSchema = createInsertSchema(schedules);
export const selectScheduleSchema = createSelectSchema(schedules);
