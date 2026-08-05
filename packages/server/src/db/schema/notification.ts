import { relations } from "drizzle-orm";
import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedJson } from "../custom-columns";
import { organizations } from "./auth";
import { notificationType } from "./enums";
import { createdAt, idColumn } from "./utils";

/**
 * A notification channel. `type` selects which config jsonb column is used.
 * The boolean columns toggle which events are sent to this channel.
 */
export const notifications = pgTable("notification", {
	notificationId: idColumn("notification_id"),
	name: text("name").notNull(),
	type: notificationType("type").notNull(),
	// Channel configs. These blobs hold webhook URLs, bot tokens and SMTP
	// passwords, so they are encrypted at rest like any other secret.
	slackConfig: encryptedJson("slack_config"),
	telegramConfig: encryptedJson("telegram_config"),
	discordConfig: encryptedJson("discord_config"),
	emailConfig: encryptedJson("email_config"),
	gotifyConfig: encryptedJson("gotify_config"),
	ntfyConfig: encryptedJson("ntfy_config"),
	pushoverConfig: encryptedJson("pushover_config"),
	mattermostConfig: encryptedJson("mattermost_config"),
	larkConfig: encryptedJson("lark_config"),
	teamsConfig: encryptedJson("teams_config"),
	customConfig: encryptedJson("custom_config"),
	// event toggles
	appDeploy: boolean("app_deploy").notNull().default(false),
	appBuildError: boolean("app_build_error").notNull().default(false),
	databaseBackup: boolean("database_backup").notNull().default(false),
	nixployRestart: boolean("nixploy_restart").notNull().default(false),
	dockerCleanup: boolean("docker_cleanup").notNull().default(false),
	serverThreshold: boolean("server_threshold").notNull().default(false),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	createdAt: createdAt(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
	organization: one(organizations, {
		fields: [notifications.organizationId],
		references: [organizations.id],
	}),
}));

export const insertNotificationSchema = createInsertSchema(notifications);
export const selectNotificationSchema = createSelectSchema(notifications);
