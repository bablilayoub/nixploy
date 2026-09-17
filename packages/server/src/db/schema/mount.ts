import { relations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { compose } from "./compose";
import { mariadb, mongo, mysql, postgres, redis } from "./database";
import { mountType, serviceType } from "./enums";
import { createdAt, idColumn } from "./utils";

/**
 * A storage mount for a service. Exactly one FK column is set per row,
 * matching `serviceType`:
 * - bind:   hostPath -> mountPath
 * - volume: volumeName -> mountPath
 * - file:   content written to filePath (relative to the service's files dir) -> mountPath
 */
export const mounts = pgTable("mount", {
	mountId: idColumn("mount_id"),
	type: mountType("type").notNull().default("volume"),
	hostPath: text("host_path"),
	volumeName: text("volume_name"),
	/** file mounts: path (relative to /etc/nixploy/files/<appName>) to write `content`. */
	filePath: text("file_path"),
	content: text("content"),
	/** Path inside the container. */
	mountPath: text("mount_path").notNull(),
	/**
	 * Compose only: which service of the stack the mount attaches to. A stack
	 * has many containers, so unlike every other kind the parent id is not
	 * enough to say where the volume goes. NULL for the single-container kinds.
	 */
	serviceName: text("service_name"),
	serviceType: serviceType("service_type").notNull().default("application"),
	applicationId: text("application_id").references(() => applications.applicationId, {
		onDelete: "cascade",
	}),
	composeId: text("compose_id").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
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
	createdAt: createdAt(),
});

export const mountsRelations = relations(mounts, ({ one }) => ({
	application: one(applications, {
		fields: [mounts.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [mounts.composeId],
		references: [compose.composeId],
	}),
	postgres: one(postgres, {
		fields: [mounts.postgresId],
		references: [postgres.postgresId],
	}),
	mysql: one(mysql, {
		fields: [mounts.mysqlId],
		references: [mysql.mysqlId],
	}),
	mariadb: one(mariadb, {
		fields: [mounts.mariadbId],
		references: [mariadb.mariadbId],
	}),
	mongo: one(mongo, {
		fields: [mounts.mongoId],
		references: [mongo.mongoId],
	}),
	redis: one(redis, {
		fields: [mounts.redisId],
		references: [redis.redisId],
	}),
}));

export const insertMountSchema = createInsertSchema(mounts);
export const selectMountSchema = createSelectSchema(mounts);
