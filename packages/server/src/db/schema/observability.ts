import { relations, sql } from "drizzle-orm";
import {
	boolean,
	customType,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { applications } from "./application";
import { organizations } from "./auth";
import { compose } from "./compose";
import { domains } from "./domain";
import { projects } from "./project";
import { createdAt, idColumn } from "./utils";

const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

/** Per-service alert rule (CPU / memory / restart count / deploy failure streak). */
export const alertRules = pgTable(
	"alert_rule",
	{
		alertRuleId: idColumn("alert_rule_id"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		applicationId: text("application_id").references(() => applications.applicationId, {
			onDelete: "cascade",
		}),
		composeId: text("compose_id").references(() => compose.composeId, {
			onDelete: "cascade",
		}),
		/** cpu | memory | restarts | deploy_failure_streak */
		metric: text("metric").notNull(),
		threshold: doublePrecision("threshold").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		cooldownMinutes: integer("cooldown_minutes").notNull().default(30),
		lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(table) => [
		index("alert_rule_application_id_idx").on(table.applicationId),
		index("alert_rule_compose_id_idx").on(table.composeId),
	],
);

/** Incident timeline entries (deploy failures, threshold trips, watchdog, uptime). */
export const incidents = pgTable(
	"incident",
	{
		incidentId: idColumn("incident_id"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		projectId: text("project_id").references(() => projects.projectId, {
			onDelete: "set null",
		}),
		/** deploy_failure | threshold | watchdog | uptime | alert_rule */
		kind: text("kind").notNull(),
		severity: text("severity").notNull().default("warning"),
		title: text("title").notNull(),
		message: text("message"),
		serviceId: text("service_id"),
		serviceName: text("service_name"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: createdAt(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		/** Someone is on it: acknowledged incidents stay open but stop nagging. */
		acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
		/** User id of the acknowledger (never shown on the public status page). */
		acknowledgedBy: text("acknowledged_by"),
	},
	(table) => [index("incident_org_created_idx").on(table.organizationId, table.createdAt.desc())],
);

/**
 * Indexed log chunks for lite search (Postgres tsvector).
 * Retention is enforced by pruning oldest rows when total size exceeds a cap.
 */
export const serviceLogs = pgTable(
	"service_log",
	{
		serviceLogId: idColumn("service_log_id"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		serviceId: text("service_id").notNull(),
		/** application | compose */
		serviceType: text("service_type").notNull(),
		deploymentId: text("deployment_id"),
		body: text("body").notNull(),
		searchVector: tsvector("search_vector"),
		createdAt: createdAt(),
	},
	(table) => [
		// Name matches 0008 (created outside Drizzle schema tracking).
		index("service_log_search_vector_idx").using("gin", table.searchVector),
		index("service_log_org_created_idx").on(table.organizationId, table.createdAt),
	],
);

/**
 * Per-service timeline: the answer to "why did it restart?".
 *
 * One row per *fact* about a service — a task that died, a deploy that
 * started, a rollback, a config change — written by the reconciler, the deploy
 * worker and the audit bridge. Separate from `incident` on purpose: an
 * incident is something a human should act on and close, an event is history
 * and is never resolved.
 *
 * `serviceId` is the primary key of whichever of the seven service tables
 * `serviceType` names, so there is no FK: a polymorphic column cannot have
 * one. Rows are reaped when their organization is deleted (that FK is real)
 * and by {@link pruneServiceEvents} for age and per-service volume; a deleted
 * service's rows go with the retention pass, not with the row.
 */
export const serviceEvents = pgTable(
	"service_event",
	{
		serviceEventId: idColumn("service_event_id"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		/** A `ServiceKind`: application | compose | postgres | mysql | mariadb | mongo | redis. */
		serviceType: text("service_type").notNull(),
		/** Primary key of the row in the table `serviceType` names. */
		serviceId: text("service_id").notNull(),
		/** Denormalised so the timeline stays readable after a rename. */
		appName: text("app_name").notNull(),
		/** One of `SERVICE_EVENT_KINDS` (modules/observability/event-kinds.ts). */
		kind: text("kind").notNull(),
		/** info | warning | error */
		severity: text("severity").notNull().default("info"),
		title: text("title").notNull(),
		message: text("message"),
		deploymentId: text("deployment_id"),
		/** Who caused it, for the events a human triggered. Null for the machine ones. */
		actorId: text("actor_id"),
		actorEmail: text("actor_email"),
		/**
		 * Stable identity of the fact this row records, unique per service.
		 *
		 * The reconciler re-reads the same finished Swarm task on every pass, so
		 * the writes are made idempotent here — `on conflict do nothing` against
		 * this index — instead of with a per-service cursor it would have to
		 * keep, invalidate and recover. NULL for one-shot events (a deploy
		 * transition happens once by construction), and Postgres treats NULLs as
		 * distinct, so those never collide.
		 */
		dedupeKey: text("dedupe_key"),
		/** Exit codes, task ids, old/new values — never a secret value. */
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		/** When it happened (Docker's timestamp), not when we noticed. */
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: createdAt(),
	},
	(table) => [
		index("service_event_service_idx").on(table.serviceId, table.occurredAt.desc()),
		index("service_event_org_created_idx").on(table.organizationId, table.occurredAt.desc()),
		uniqueIndex("service_event_dedupe_idx").on(table.serviceId, table.dedupeKey),
	],
);

export const serviceEventsRelations = relations(serviceEvents, ({ one }) => ({
	organization: one(organizations, {
		fields: [serviceEvents.organizationId],
		references: [organizations.id],
	}),
}));

/** Optional HTTP uptime probe configuration (one row per domain when enabled). */
export const uptimeProbes = pgTable("uptime_probe", {
	uptimeProbeId: idColumn("uptime_probe_id"),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	domainId: text("domain_id")
		.notNull()
		.references(() => domains.domainId, { onDelete: "cascade" })
		.unique(),
	enabled: boolean("enabled").notNull().default(true),
	path: text("path").notNull().default("/"),
	expectedStatus: integer("expected_status").notNull().default(200),
	intervalSeconds: integer("interval_seconds").notNull().default(60),
	timeoutMs: integer("timeout_ms").notNull().default(10_000),
	/** up | down | unknown */
	status: text("status").notNull().default("unknown"),
	lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
	lastStatusChangeAt: timestamp("last_status_change_at", { withTimezone: true }),
	lastError: text("last_error"),
	createdAt: createdAt(),
});

/**
 * Public status page for an organization: one row per org, addressed by an
 * unguessable `token` at `/status/<token>`. `probeIds` selects which uptime
 * probes are published — nothing else of the org is ever exposed.
 */
export const statusPages = pgTable("status_page", {
	statusPageId: idColumn("status_page_id"),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" })
		.unique(),
	/** Rotatable secret in the URL; the page has no other authentication. */
	token: text("token").notNull().unique(),
	title: text("title").notNull().default("Status"),
	/** `uptime_probe` ids published on the page (order preserved). */
	probeIds: jsonb("probe_ids").$type<string[]>().notNull().default([]),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: createdAt(),
});

export const statusPagesRelations = relations(statusPages, ({ one }) => ({
	organization: one(organizations, {
		fields: [statusPages.organizationId],
		references: [organizations.id],
	}),
}));

export const alertRulesRelations = relations(alertRules, ({ one }) => ({
	organization: one(organizations, {
		fields: [alertRules.organizationId],
		references: [organizations.id],
	}),
	application: one(applications, {
		fields: [alertRules.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [alertRules.composeId],
		references: [compose.composeId],
	}),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
	organization: one(organizations, {
		fields: [incidents.organizationId],
		references: [organizations.id],
	}),
	project: one(projects, {
		fields: [incidents.projectId],
		references: [projects.projectId],
	}),
}));

export const uptimeProbesRelations = relations(uptimeProbes, ({ one }) => ({
	organization: one(organizations, {
		fields: [uptimeProbes.organizationId],
		references: [organizations.id],
	}),
	domain: one(domains, {
		fields: [uptimeProbes.domainId],
		references: [domains.domainId],
	}),
}));

/** Helper SQL to refresh search_vector (used after insert). */
export const serviceLogSearchVectorSql = (bodyColumn = "body") =>
	sql`to_tsvector('english', ${sql.raw(bodyColumn)})`;
