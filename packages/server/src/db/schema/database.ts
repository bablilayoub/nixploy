import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { serviceStatus, serviceType } from "./enums";
import { environments } from "./project";
import { servers } from "./server";
import { createdAt, idColumn } from "./utils";

export const postgres = pgTable("postgres", {
	postgresId: idColumn("postgres_id"),
	name: text("name").notNull(),
	appName: text("app_name").notNull().unique(),
	description: text("description"),
	env: encryptedText("env"),
	status: serviceStatus("status").notNull().default("idle"),
	dockerImage: text("docker_image").notNull().default("postgres:15"),
	/**
	 * Curated engine version picked in the panel (`17`, `8.4`, …), from
	 * `modules/databases/versions.ts`. `dockerImage` is derived from it
	 * (`<engine>:<version>`); null means the row predates the picker or uses a
	 * custom image, and then `dockerImage` is the only source of truth.
	 */
	engineVersion: text("engine_version"),
	databaseName: text("database_name").notNull(),
	databaseUser: text("database_user").notNull(),
	databasePassword: encryptedText("database_password").notNull(),
	/** Published host port for external connections; null = internal only. */
	externalPort: integer("external_port"),
	command: text("command"),
	memoryReservation: text("memory_reservation"),
	memoryLimit: text("memory_limit"),
	cpuReservation: text("cpu_reservation"),
	cpuLimit: text("cpu_limit"),
	environmentId: text("environment_id")
		.notNull()
		.references(() => environments.environmentId, { onDelete: "cascade" }),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

export const mysql = pgTable("mysql", {
	mysqlId: idColumn("mysql_id"),
	name: text("name").notNull(),
	appName: text("app_name").notNull().unique(),
	description: text("description"),
	env: encryptedText("env"),
	status: serviceStatus("status").notNull().default("idle"),
	dockerImage: text("docker_image").notNull().default("mysql:8"),
	/**
	 * Curated engine version picked in the panel (`17`, `8.4`, …), from
	 * `modules/databases/versions.ts`. `dockerImage` is derived from it
	 * (`<engine>:<version>`); null means the row predates the picker or uses a
	 * custom image, and then `dockerImage` is the only source of truth.
	 */
	engineVersion: text("engine_version"),
	databaseName: text("database_name").notNull(),
	databaseUser: text("database_user").notNull(),
	databasePassword: encryptedText("database_password").notNull(),
	databaseRootPassword: encryptedText("database_root_password").notNull(),
	externalPort: integer("external_port"),
	command: text("command"),
	memoryReservation: text("memory_reservation"),
	memoryLimit: text("memory_limit"),
	cpuReservation: text("cpu_reservation"),
	cpuLimit: text("cpu_limit"),
	environmentId: text("environment_id")
		.notNull()
		.references(() => environments.environmentId, { onDelete: "cascade" }),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

export const mariadb = pgTable("mariadb", {
	mariadbId: idColumn("mariadb_id"),
	name: text("name").notNull(),
	appName: text("app_name").notNull().unique(),
	description: text("description"),
	env: encryptedText("env"),
	status: serviceStatus("status").notNull().default("idle"),
	dockerImage: text("docker_image").notNull().default("mariadb:11"),
	/**
	 * Curated engine version picked in the panel (`17`, `8.4`, …), from
	 * `modules/databases/versions.ts`. `dockerImage` is derived from it
	 * (`<engine>:<version>`); null means the row predates the picker or uses a
	 * custom image, and then `dockerImage` is the only source of truth.
	 */
	engineVersion: text("engine_version"),
	databaseName: text("database_name").notNull(),
	databaseUser: text("database_user").notNull(),
	databasePassword: encryptedText("database_password").notNull(),
	databaseRootPassword: encryptedText("database_root_password").notNull(),
	externalPort: integer("external_port"),
	command: text("command"),
	memoryReservation: text("memory_reservation"),
	memoryLimit: text("memory_limit"),
	cpuReservation: text("cpu_reservation"),
	cpuLimit: text("cpu_limit"),
	environmentId: text("environment_id")
		.notNull()
		.references(() => environments.environmentId, { onDelete: "cascade" }),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

export const mongo = pgTable("mongo", {
	mongoId: idColumn("mongo_id"),
	name: text("name").notNull(),
	appName: text("app_name").notNull().unique(),
	description: text("description"),
	env: encryptedText("env"),
	status: serviceStatus("status").notNull().default("idle"),
	dockerImage: text("docker_image").notNull().default("mongo:6"),
	/**
	 * Curated engine version picked in the panel (`17`, `8.4`, …), from
	 * `modules/databases/versions.ts`. `dockerImage` is derived from it
	 * (`<engine>:<version>`); null means the row predates the picker or uses a
	 * custom image, and then `dockerImage` is the only source of truth.
	 */
	engineVersion: text("engine_version"),
	databaseUser: text("database_user").notNull(),
	databasePassword: encryptedText("database_password").notNull(),
	externalPort: integer("external_port"),
	command: text("command"),
	replicaSet: text("replica_set").notNull().default(""),
	memoryReservation: text("memory_reservation"),
	memoryLimit: text("memory_limit"),
	cpuReservation: text("cpu_reservation"),
	cpuLimit: text("cpu_limit"),
	environmentId: text("environment_id")
		.notNull()
		.references(() => environments.environmentId, { onDelete: "cascade" }),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

export const redis = pgTable("redis", {
	redisId: idColumn("redis_id"),
	name: text("name").notNull(),
	appName: text("app_name").notNull().unique(),
	description: text("description"),
	env: encryptedText("env"),
	status: serviceStatus("status").notNull().default("idle"),
	dockerImage: text("docker_image").notNull().default("redis:7"),
	/**
	 * Curated engine version picked in the panel (`17`, `8.4`, …), from
	 * `modules/databases/versions.ts`. `dockerImage` is derived from it
	 * (`<engine>:<version>`); null means the row predates the picker or uses a
	 * custom image, and then `dockerImage` is the only source of truth.
	 */
	engineVersion: text("engine_version"),
	databasePassword: encryptedText("database_password").notNull(),
	externalPort: integer("external_port"),
	command: text("command"),
	memoryReservation: text("memory_reservation"),
	memoryLimit: text("memory_limit"),
	cpuReservation: text("cpu_reservation"),
	cpuLimit: text("cpu_limit"),
	environmentId: text("environment_id")
		.notNull()
		.references(() => environments.environmentId, { onDelete: "cascade" }),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

/**
 * An additional logical database + owning user inside one managed engine
 * (postgres/mysql/mariadb/mongo — redis has no such concept and is refused by
 * the router). Exactly one FK column is set per row, matching `serviceType`,
 * the same shape `mount` and `backup` use for their polymorphic parent.
 *
 * The row is bookkeeping only: the real objects are created by
 * `modules/databases/logical.ts` with `docker exec` into the running
 * container, never over the overlay network. `password` is generated
 * server-side and redacted for members without `secrets.read`.
 */
export const databaseLogicals = pgTable(
	"database_logical",
	{
		databaseLogicalId: idColumn("database_logical_id"),
		serviceType: serviceType("service_type").notNull(),
		/** Logical database name (mongo: the db the user owns). */
		name: text("name").notNull(),
		/** Owning role/user created alongside the database. */
		username: text("username").notNull(),
		password: encryptedText("password").notNull(),
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
	},
	(table) => [
		// NULL FKs never collide in a Postgres unique index, so one index per
		// parent column is enough to keep names unique inside each instance.
		uniqueIndex("database_logical_postgres_name_unique").on(table.postgresId, table.name),
		uniqueIndex("database_logical_mysql_name_unique").on(table.mysqlId, table.name),
		uniqueIndex("database_logical_mariadb_name_unique").on(table.mariadbId, table.name),
		uniqueIndex("database_logical_mongo_name_unique").on(table.mongoId, table.name),
		index("database_logical_service_type_idx").on(table.serviceType),
	],
);

// ── relations ───────────────────────────────────────────────────────────────

export const postgresRelations = relations(postgres, ({ one }) => ({
	environment: one(environments, {
		fields: [postgres.environmentId],
		references: [environments.environmentId],
	}),
	server: one(servers, {
		fields: [postgres.serverId],
		references: [servers.serverId],
	}),
}));

export const mysqlRelations = relations(mysql, ({ one }) => ({
	environment: one(environments, {
		fields: [mysql.environmentId],
		references: [environments.environmentId],
	}),
	server: one(servers, {
		fields: [mysql.serverId],
		references: [servers.serverId],
	}),
}));

export const mariadbRelations = relations(mariadb, ({ one }) => ({
	environment: one(environments, {
		fields: [mariadb.environmentId],
		references: [environments.environmentId],
	}),
	server: one(servers, {
		fields: [mariadb.serverId],
		references: [servers.serverId],
	}),
}));

export const mongoRelations = relations(mongo, ({ one }) => ({
	environment: one(environments, {
		fields: [mongo.environmentId],
		references: [environments.environmentId],
	}),
	server: one(servers, {
		fields: [mongo.serverId],
		references: [servers.serverId],
	}),
}));

export const redisRelations = relations(redis, ({ one }) => ({
	environment: one(environments, {
		fields: [redis.environmentId],
		references: [environments.environmentId],
	}),
	server: one(servers, {
		fields: [redis.serverId],
		references: [servers.serverId],
	}),
}));

// ── zod schemas ─────────────────────────────────────────────────────────────

export const databaseLogicalsRelations = relations(databaseLogicals, ({ one }) => ({
	postgres: one(postgres, {
		fields: [databaseLogicals.postgresId],
		references: [postgres.postgresId],
	}),
	mysql: one(mysql, {
		fields: [databaseLogicals.mysqlId],
		references: [mysql.mysqlId],
	}),
	mariadb: one(mariadb, {
		fields: [databaseLogicals.mariadbId],
		references: [mariadb.mariadbId],
	}),
	mongo: one(mongo, {
		fields: [databaseLogicals.mongoId],
		references: [mongo.mongoId],
	}),
}));

export const insertDatabaseLogicalSchema = createInsertSchema(databaseLogicals);
export const selectDatabaseLogicalSchema = createSelectSchema(databaseLogicals);
export const insertPostgresSchema = createInsertSchema(postgres);
export const selectPostgresSchema = createSelectSchema(postgres);
export const insertMysqlSchema = createInsertSchema(mysql);
export const selectMysqlSchema = createSelectSchema(mysql);
export const insertMariadbSchema = createInsertSchema(mariadb);
export const selectMariadbSchema = createSelectSchema(mariadb);
export const insertMongoSchema = createInsertSchema(mongo);
export const selectMongoSchema = createSelectSchema(mongo);
export const insertRedisSchema = createInsertSchema(redis);
export const selectRedisSchema = createSelectSchema(redis);
