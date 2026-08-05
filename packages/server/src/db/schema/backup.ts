import { relations } from "drizzle-orm";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { applications } from "./application";
import { organizations } from "./auth";
import { compose } from "./compose";
import { mariadb, mongo, mysql, postgres } from "./database";
import { databaseType, serviceType } from "./enums";
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
	createdAt: createdAt(),
});

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
