import { relations } from "drizzle-orm";
import { bigint, boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { applications } from "./application";
import { organizations } from "./auth";
import { compose } from "./compose";
import { mariadb, mongo, mysql, postgres, redis } from "./database";
import { backupRunKind, backupRunStatus, databaseType, serviceType } from "./enums";
import { createdAt, idColumn } from "./utils";

/** An S3-compatible bucket where backups are uploaded. */
export const destinations = pgTable("destination", {
	destinationId: idColumn("destination_id"),
	name: text("name").notNull(),
	accessKey: encryptedText("access_key").notNull(),
	secretAccessKey: encryptedText("secret_access_key").notNull(),
	bucket: text("bucket").notNull(),
	region: text("region").notNull(),
	endpoint: text("endpoint").notNull(),
	provider: text("provider").notNull().default("s3"),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	createdAt: createdAt(),
});

/** Scheduled database dump -> S3 destination. Exactly one DB FK is set. */
export const backups = pgTable("backup", {
	backupId: idColumn("backup_id"),
	appName: text("app_name").notNull(),
	/** Cron expression. */
	schedule: text("schedule").notNull(),
	enabled: boolean("enabled").notNull().default(true),
	prefix: text("prefix").notNull().default("backup"),
	database: text("database").notNull(),
	databaseType: databaseType("database_type").notNull(),
	keepLatestCount: integer("keep_latest_count"),
	destinationId: text("destination_id")
		.notNull()
		.references(() => destinations.destinationId, { onDelete: "cascade" }),
	postgresId: text("postgres_id").references(() => postgres.postgresId, {
		onDelete: "cascade",
	}),
	mysqlId: text("mysql_id").references(() => mysql.mysqlId, {
		onDelete: "cascade",
	}),
	mariadbId: text("mariadb_id").references(() => mariadb.mariadbId, {
		onDelete: "cascade",
	}),
	mongoId: text("mongo_id").references(() => mongo.mongoId, {
		onDelete: "cascade",
	}),
	redisId: text("redis_id").references(() => redis.redisId, {
		onDelete: "cascade",
	}),
	/** Written when a run starts — see `schedule.last_run_at` for why. */
	lastRunAt: timestamp("last_run_at", { withTimezone: true }),
	createdAt: createdAt(),
});

/** Scheduled archive of a named volume -> S3 destination. */
export const volumeBackups = pgTable("volume_backup", {
	volumeBackupId: idColumn("volume_backup_id"),
	name: text("name").notNull(),
	volumeName: text("volume_name").notNull(),
	serviceType: serviceType("service_type").notNull(),
	/** Cron expression. */
	cronExpression: text("cron_expression").notNull(),
	enabled: boolean("enabled").notNull().default(true),
	prefix: text("prefix").notNull().default("volume-backup"),
	keepLatestCount: integer("keep_latest_count"),
	destinationId: text("destination_id")
		.notNull()
		.references(() => destinations.destinationId, { onDelete: "cascade" }),
	applicationId: text("application_id").references(() => applications.applicationId, {
		onDelete: "cascade",
	}),
	composeId: text("compose_id").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	/** Written when a run starts — see `schedule.last_run_at` for why. */
	lastRunAt: timestamp("last_run_at", { withTimezone: true }),
	createdAt: createdAt(),
});

/**
 * One row per backup execution (database dump, volume archive or instance
 * export). `backupId` / `volumeBackupId` are both null for instance runs.
 */
export const backupRuns = pgTable(
	"backup_run",
	{
		backupRunId: idColumn("backup_run_id"),
		backupId: text("backup_id").references(() => backups.backupId, { onDelete: "cascade" }),
		volumeBackupId: text("volume_backup_id").references(() => volumeBackups.volumeBackupId, {
			onDelete: "cascade",
		}),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		kind: backupRunKind("kind").notNull(),
		status: backupRunStatus("status").notNull().default("running"),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		/** Uploaded object size. */
		bytes: bigint("bytes", { mode: "number" }),
		/** S3 key of the uploaded object. */
		objectKey: text("object_key"),
		destinationId: text("destination_id").references(() => destinations.destinationId, {
			onDelete: "set null",
		}),
		error: text("error"),
		/** `schedule` | `manual`. */
		trigger: text("trigger").notNull().default("manual"),
	},
	(table) => [
		index("backup_run_org_started_idx").on(table.organizationId, table.startedAt.desc()),
		index("backup_run_backup_started_idx").on(table.backupId, table.startedAt.desc()),
		index("backup_run_volume_started_idx").on(table.volumeBackupId, table.startedAt.desc()),
	],
);

export const destinationsRelations = relations(destinations, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [destinations.organizationId],
		references: [organizations.id],
	}),
	backups: many(backups),
	volumeBackups: many(volumeBackups),
}));

export const backupsRelations = relations(backups, ({ one }) => ({
	destination: one(destinations, {
		fields: [backups.destinationId],
		references: [destinations.destinationId],
	}),
	postgres: one(postgres, {
		fields: [backups.postgresId],
		references: [postgres.postgresId],
	}),
	mysql: one(mysql, {
		fields: [backups.mysqlId],
		references: [mysql.mysqlId],
	}),
	mariadb: one(mariadb, {
		fields: [backups.mariadbId],
		references: [mariadb.mariadbId],
	}),
	mongo: one(mongo, {
		fields: [backups.mongoId],
		references: [mongo.mongoId],
	}),
	redis: one(redis, {
		fields: [backups.redisId],
		references: [redis.redisId],
	}),
}));

export const volumeBackupsRelations = relations(volumeBackups, ({ one }) => ({
	destination: one(destinations, {
		fields: [volumeBackups.destinationId],
		references: [destinations.destinationId],
	}),
	application: one(applications, {
		fields: [volumeBackups.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [volumeBackups.composeId],
		references: [compose.composeId],
	}),
}));

export const insertDestinationSchema = createInsertSchema(destinations);
export const selectDestinationSchema = createSelectSchema(destinations);
export const insertBackupSchema = createInsertSchema(backups);
export const selectBackupSchema = createSelectSchema(backups);
export const insertVolumeBackupSchema = createInsertSchema(volumeBackups);
export const selectVolumeBackupSchema = createSelectSchema(volumeBackups);

export const backupRunsRelations = relations(backupRuns, ({ one }) => ({
	organization: one(organizations, {
		fields: [backupRuns.organizationId],
		references: [organizations.id],
	}),
	backup: one(backups, {
		fields: [backupRuns.backupId],
		references: [backups.backupId],
	}),
	volumeBackup: one(volumeBackups, {
		fields: [backupRuns.volumeBackupId],
		references: [volumeBackups.volumeBackupId],
	}),
	destination: one(destinations, {
		fields: [backupRuns.destinationId],
		references: [destinations.destinationId],
	}),
}));

export const insertBackupRunSchema = createInsertSchema(backupRuns);
export const selectBackupRunSchema = createSelectSchema(backupRuns);
export type BackupRun = typeof backupRuns.$inferSelect;
export type NewBackupRun = typeof backupRuns.$inferInsert;
export type BackupRunKind = BackupRun["kind"];
export type BackupRunStatus = BackupRun["status"];
