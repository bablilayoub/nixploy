import { relations, sql } from "drizzle-orm";
import {
	boolean,
	customType,
	doublePrecision,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
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
export const alertRules = pgTable("alert_rule", {
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
});

/** Incident timeline entries (deploy failures, threshold trips, watchdog, uptime). */
export const incidents = pgTable("incident", {
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
});

/**
 * Indexed log chunks for lite search (Postgres tsvector).
 * Retention is enforced by pruning oldest rows when total size exceeds a cap.
 */
export const serviceLogs = pgTable("service_log", {
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
});

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
