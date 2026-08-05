import { relations } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { serviceStatus } from "./enums";
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
