import { relations } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { applications } from "./application";
import { compose } from "./compose";
import { portProtocol, publishMode } from "./enums";
import { createdAt, idColumn } from "./utils";

/** A published swarm port mapping for a service. */
export const ports = pgTable("port", {
	portId: idColumn("port_id"),
	publishedPort: integer("published_port").notNull(),
	targetPort: integer("target_port").notNull(),
	protocol: portProtocol("protocol").notNull().default("tcp"),
	publishMode: publishMode("publish_mode").notNull().default("ingress"),
	applicationId: text("application_id").references(() => applications.applicationId, {
		onDelete: "cascade",
	}),
	composeId: text("compose_id").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	createdAt: createdAt(),
});

export const portsRelations = relations(ports, ({ one }) => ({
	application: one(applications, {
		fields: [ports.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [ports.composeId],
		references: [compose.composeId],
	}),
}));

export const insertPortSchema = createInsertSchema(ports);
export const selectPortSchema = createSelectSchema(ports);
