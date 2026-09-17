import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	index,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { compose } from "./compose";
import { deploymentStatus, deploymentTrigger, previewStatus } from "./enums";
import { servers } from "./server";
import { createdAt, idColumn } from "./utils";

/** One row per deploy job; logs are written to `logPath` on disk. */
export const deployments = pgTable(
	"deployment",
	{
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
		/** Provenance: resolved after clone (git) or set from the webhook payload. */
		commitSha: text("commit_sha"),
		/** Full commit message; the UI shows the first line. */
		commitMessage: text("commit_message"),
		commitAuthor: text("commit_author"),
		/**
		 * The ref the caller asked for (branch, tag or sha) when it was not the
		 * service's configured branch. NULL means "the configured branch", which
		 * is what every webhook push and every plain Deploy records. Kept beside
		 * `commitSha` because the two answer different questions: this is what
		 * was requested, that is what it resolved to.
		 */
		requestedRef: text("requested_ref"),
		/**
		 * The pipeline phase the job is in, or the one it died in
		 * (`modules/deployment/steps.ts`). NULL while the row is still queued,
		 * and on rows written before migration 0034.
		 *
		 * A column rather than something parsed out of the log: the log is free
		 * text, and a machine-readable "failing step" that depends on matching
		 * English sentences breaks the first time someone rewords a line.
		 */
		currentStep: text("current_step"),
		/** What started the job (null on rows older than migration 0020). */
		trigger: deploymentTrigger("trigger"),
		/** User id for `manual`/`api`, `webhook:<provider>` for pushes, `system` otherwise. */
		triggeredBy: text("triggered_by"),
		/**
		 * Service name this job builds — the queue's coalescing key and its
		 * per-app mutex key. Equal to the application/compose `app_name` for a
		 * normal job and to `<app>-pr-<n>` for a preview, which is exactly why
		 * the queue can no longer derive it from a join: a preview row carries
		 * the PARENT application's id. Nullable — rows written by schedule runs
		 * (`modules/schedules#recordRun`) never enter the queue.
		 */
		appName: text("app_name"),
		/** Set for preview (per-PR) jobs; the row's `applicationId` is the PARENT's. */
		previewDeploymentId: text("preview_deployment_id").references(
			(): AnyPgColumn => previewDeployments.previewDeploymentId,
			{ onDelete: "set null" },
		),
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
	},
	(table) => [
		index("deployment_app_created_idx").on(table.applicationId, table.createdAt.desc()),
		index("deployment_compose_created_idx").on(table.composeId, table.createdAt.desc()),
		// In-flight rows (queued/running) for the reconciler, boot recovery and
		// queue-position lookups. The predicate names the TERMINAL labels on
		// purpose: the migrator applies every pending file in one transaction,
		// and Postgres refuses to reference an enum value added in that same
		// transaction ("unsafe use of new value") — see drizzle/0019.
		index("deployment_active_status_idx")
			.on(table.status)
			.where(sql`"status" NOT IN ('done', 'error', 'cancelled')`),
		// The durable queue's hot path: the claim statement orders the in-flight
		// rows of one server line and its `NOT EXISTS` per-app mutex looks up
		// `app_name` among them. Same terminal-label predicate as above — an
		// enum value added in the migrator's transaction cannot be referenced.
		index("deployment_queued_app_idx")
			.on(table.appName)
			.where(sql`"status" NOT IN ('done', 'error', 'cancelled')`),
		index("deployment_created_idx").on(table.createdAt.desc()),
		index("deployment_schedule_created_idx").on(table.scheduleId, table.createdAt.desc()),
	],
);

/**
 * A preview (per-PR) instance of an application **or** of a compose service.
 * Exactly one of `applicationId` / `composeId` is set (CHECK constraint):
 * every other column — the `<parent>-pr-<n>` `appName`, the PR metadata, the
 * status, the expiry — means the same thing for both kinds, which is what
 * lets `modules/preview` run one lifecycle over a `PreviewParent` shape.
 */
export const previewDeployments = pgTable(
	"preview_deployment",
	{
		previewDeploymentId: idColumn("preview_deployment_id"),
		/**
		 * Service name of the preview instance: `<parent appName>-pr-<n>`. For a
		 * compose preview this is also the compose project / stack name and the
		 * prefix of its private `<appName>-net`, so a preview can never collide
		 * with the production stack it was forked from.
		 */
		appName: text("app_name").notNull(),
		branch: text("branch"),
		pullRequestId: text("pull_request_id"),
		pullRequestNumber: text("pull_request_number"),
		pullRequestTitle: text("pull_request_title"),
		pullRequestURL: text("pull_request_url"),
		/** Provider login of the PR author (shown on the approval gate). */
		pullRequestAuthor: text("pull_request_author"),
		/**
		 * Head commit of the pull request, refreshed on every `synchronize`
		 * delivery. Stored on the preview row (not only on the deployment rows
		 * it spawns) because the Previews tab lists previews, a gated fork PR
		 * never produces a deployment at all, and some providers hand us a
		 * commit URL — GitLab's `last_commit.url`, Bitbucket's
		 * `links.html.href` — that no derivation from the repo URL reproduces.
		 */
		commitSha: text("commit_sha"),
		/** First line of the head commit message, capped by the webhook parser. */
		commitMessage: text("commit_message"),
		commitAuthor: text("commit_author"),
		/** Provider commit page; null when the provider sent none and none could be built. */
		commitUrl: text("commit_url"),
		previewStatus: previewStatus("preview_status").notNull().default("idle"),
		domainId: text("domain_id"),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		/** Parent application, or null when this preview belongs to a compose service. */
		applicationId: text("application_id").references(() => applications.applicationId, {
			onDelete: "cascade",
		}),
		/** Parent compose service, or null when this preview belongs to an application. */
		composeId: text("compose_id").references(() => compose.composeId, {
			onDelete: "cascade",
		}),
		serverId: text("server_id").references(() => servers.serverId, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(table) => [
		index("preview_deployment_application_id_idx").on(table.applicationId),
		index("preview_deployment_compose_id_idx").on(table.composeId),
		// A preview has exactly one parent. Without this, a row with both ids
		// (or neither) would be deployed by whichever branch the worker checked
		// first, and the org resolution would have two answers.
		check(
			"preview_deployment_one_parent",
			sql`("application_id" IS NOT NULL) <> ("compose_id" IS NOT NULL)`,
		),
	],
);

/** A pinned image a service can be rolled back to. */
export const rollbacks = pgTable(
	"rollback",
	{
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
	},
	(table) => [index("rollback_application_id_idx").on(table.applicationId)],
);

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
	compose: one(compose, {
		fields: [previewDeployments.composeId],
		references: [compose.composeId],
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
export type Deployment = typeof deployments.$inferSelect;
export type DeploymentTrigger = NonNullable<Deployment["trigger"]>;
export const insertPreviewDeploymentSchema = createInsertSchema(previewDeployments);
export const selectPreviewDeploymentSchema = createSelectSchema(previewDeployments);
export const insertRollbackSchema = createInsertSchema(rollbacks);
export const selectRollbackSchema = createSelectSchema(rollbacks);
