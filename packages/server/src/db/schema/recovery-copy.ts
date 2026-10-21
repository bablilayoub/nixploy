import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import { backups } from "./backup";
import { postgres } from "./database";
import { environments } from "./project";
import { createdAt, idColumn } from "./utils";

/** A retained, private PostgreSQL restore. Credentials live only on its managed service. */
export const recoveryCopies = pgTable(
	"recovery_copy",
	{
		recoveryCopyId: idColumn("recovery_copy_id"),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "restrict" }),
		requestId: text("request_id").notNull(),
		backupId: text("backup_id").references(() => backups.backupId, { onDelete: "set null" }),
		sourcePostgresId: text("source_postgres_id").references(() => postgres.postgresId, {
			onDelete: "set null",
		}),
		targetPostgresId: text("target_postgres_id").references(() => postgres.postgresId, {
			onDelete: "restrict",
		}),
		/** Immutable placement; null is local. Deliberately survives server deletion. */
		originServerId: text("origin_server_id"),
		/** Exact daemon/node identity; survives server removal or a Swarm rejoin. */
		originSwarmNodeId: text("origin_swarm_node_id"),
		originAppName: text("origin_app_name"),
		/** Presence records a known origin; legacy rows must not guess a location. */
		originVolumeName: text("origin_volume_name"),
		/** Exact Docker volume identity, recorded before restored SQL can run. */
		originVolumeCreatedAt: text("origin_volume_created_at"),
		environmentId: text("environment_id")
			.notNull()
			.references(() => environments.environmentId, { onDelete: "restrict" }),
		name: text("name").notNull(),
		objectKey: text("object_key").notNull(),
		status: text("status").notNull().default("validating"),
		/** Fixed operation budget; expired work is shown as interrupted, never ready. */
		deadline: timestamp("deadline", { withTimezone: true }).notNull(),
		tableCount: integer("table_count"),
		error: text("error"),
		createdAt: createdAt(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("recovery_copy_request_idx").on(table.organizationId, table.requestId),
		index("recovery_copy_backup_idx").on(table.backupId, table.createdAt),
	],
);
