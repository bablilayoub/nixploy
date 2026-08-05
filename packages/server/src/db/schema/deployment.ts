import { relations } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { compose } from "./compose";
import { deploymentStatus, previewStatus } from "./enums";
import { servers } from "./server";
import { createdAt, idColumn } from "./utils";

/** One row per deploy job; logs are written to `logPath` on disk. */
export const deployments = pgTable("deployment", {
	deploymentId: idColumn("deployment_id"),
	title: text("title").notNull().default("Deployment"),
	description: text("description"),
	status: deploymentStatus("status").notNull().default("running"),
	/** Absolute path of the build/deploy log file. */
	logPath: text("log_path").notNull(),
	/** PID of the running deploy process, used for cancellation. */
	pid: text("pid"),
	isPreview: boolean("is_preview").notNull().default(false),
	errorMessage: text("error_message"),
	startedAt: timestamp("started_at", { withTimezone: true }),
	finishedAt: timestamp("finished_at", { withTimezone: true }),
	applicationId: text("application_id").references(() => applications.applicationId, {
		onDelete: "cascade",
	}),
	composeId: text("compose_id").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	scheduleId: text("schedule_id"),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

/** A preview (per-PR) instance of an application. */
export const previewDeployments = pgTable("preview_deployment", {
	previewDeploymentId: idColumn("preview_deployment_id"),
	appName: text("app_name").notNull(),
	branch: text("branch"),
	pullRequestId: text("pull_request_id"),
	pullRequestNumber: text("pull_request_number"),
	pullRequestTitle: text("pull_request_title"),
	pullRequestURL: text("pull_request_url"),
	previewStatus: previewStatus("preview_status").notNull().default("idle"),
	domainId: text("domain_id"),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	applicationId: text("application_id")
		.notNull()
		.references(() => applications.applicationId, { onDelete: "cascade" }),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

/** A pinned image a service can be rolled back to. */
export const rollbacks = pgTable("rollback", {
	rollbackId: idColumn("rollback_id"),
	/** Full image reference, e.g. `registry/app@sha256:...` or tagged image. */
	image: text("image").notNull(),
	fullContext: text("full_context"),
	version: text("version"),
	applicationId: text("application_id")
		.notNull()
		.references(() => applications.applicationId, { onDelete: "cascade" }),
	deploymentId: text("deployment_id").references(() => deployments.deploymentId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

export const deploymentsRelations = relations(deployments, ({ one }) => ({
	application: one(applications, {
		fields: [deployments.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [deployments.composeId],
		references: [compose.composeId],
	}),
	server: one(servers, {
		fields: [deployments.serverId],
		references: [servers.serverId],
	}),
}));

export const previewDeploymentsRelations = relations(previewDeployments, ({ one }) => ({
	application: one(applications, {
		fields: [previewDeployments.applicationId],
		references: [applications.applicationId],
	}),
	server: one(servers, {
		fields: [previewDeployments.serverId],
		references: [servers.serverId],
	}),
}));

export const rollbacksRelations = relations(rollbacks, ({ one }) => ({
	application: one(applications, {
		fields: [rollbacks.applicationId],
		references: [applications.applicationId],
	}),
	deployment: one(deployments, {
		fields: [rollbacks.deploymentId],
		references: [deployments.deploymentId],
	}),
}));

export const insertDeploymentSchema = createInsertSchema(deployments);
export const selectDeploymentSchema = createSelectSchema(deployments);
export const insertPreviewDeploymentSchema = createInsertSchema(previewDeployments);
export const selectPreviewDeploymentSchema = createSelectSchema(previewDeployments);
export const insertRollbackSchema = createInsertSchema(rollbacks);
export const selectRollbackSchema = createSelectSchema(rollbacks);
