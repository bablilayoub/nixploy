import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedJson, encryptedText } from "../custom-columns";
import { organizations } from "./auth";
import { certificateType, serverStatus, swarmRole } from "./enums";
import { createdAt, idColumn } from "./utils";

export const sshKeys = pgTable("ssh_key", {
	sshKeyId: idColumn("ssh_key_id"),
	name: text("name").notNull(),
	description: text("description"),
	privateKey: encryptedText("private_key").notNull(),
	publicKey: text("public_key").notNull(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	createdAt: createdAt(),
});

/** A remote (or local) Docker host managed over SSH. */
export const servers = pgTable(
	"server",
	{
		serverId: idColumn("server_id"),
		name: text("name").notNull(),
		description: text("description"),
		ipAddress: text("ip_address").notNull(),
		port: integer("port").notNull().default(22),
		username: text("username").notNull().default("root"),
		sshKeyId: text("ssh_key_id").references(() => sshKeys.sshKeyId, {
			onDelete: "set null",
		}),
		serverStatus: serverStatus("server_status").notNull().default("active"),
		/** Join the primary swarm as a worker (default) or manager. */
		swarmRole: swarmRole("swarm_role").notNull().default("worker"),
		/**
		 * Swarm node id of this server in the PRIMARY swarm (`docker info
		 * .Swarm.NodeID`), recorded by `setupServer` after the join and lazily
		 * by `getServerSwarmNodeId`. Services pinned to the server are placed
		 * with `node.id==<swarmNodeId>`; null until the server has joined.
		 */
		swarmNodeId: text("swarm_node_id"),
		/** Shell command run after provisioning (swarm join log etc.). */
		command: text("command").notNull().default(""),
		metricsConfig: jsonb("metrics_config"),
		enableDockerCleanup: boolean("enable_docker_cleanup").notNull().default(false),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [index("server_organization_id_idx").on(table.organizationId)],
);

/** Singleton row with settings for the Nixploy host itself. */
export const webServerSettings = pgTable("web_server_settings", {
	webServerSettingsId: idColumn("web_server_settings_id"),
	host: text("host"),
	letsEncryptEmail: text("lets_encrypt_email"),
	certificateType: certificateType("certificate_type").notNull().default("none"),
	/**
	 * Traefik ACME DNS-01 provider code (`cloudflare`, `route53`, …). When set,
	 * `ensureTraefikSetup` renders a second resolver `letsencrypt-dns` that
	 * wildcard domains use; the provider credentials are passed to the Traefik
	 * container as environment variables by the operator (see docs).
	 */
	acmeDnsProvider: text("acme_dns_provider"),
	/** Provider credentials (`{ CF_DNS_API_TOKEN: "…" }`), encrypted at rest. */
	acmeDnsCredentials: encryptedJson("acme_dns_credentials"),
	/**
	 * Instance-wide opt-in for outbound requests to private/LAN addresses
	 * (self-hosted MinIO, Gotify, Gitea, SMTP on the same network). Off by
	 * default: without it every provider that used to default to
	 * `allowPrivate: true` was an org-admin port scanner (security audit 2.6).
	 * The Swarm overlay (10.0.0.0/8) stays unreachable as a literal even when
	 * this is on — see `utils/public-url.ts`.
	 */
	allowPrivateEgress: boolean("allow_private_egress").notNull().default(false),
	metricsConfig: jsonb("metrics_config"),
	createdAt: createdAt(),
});

export const sshKeysRelations = relations(sshKeys, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [sshKeys.organizationId],
		references: [organizations.id],
	}),
	servers: many(servers),
}));

export const serversRelations = relations(servers, ({ one }) => ({
	organization: one(organizations, {
		fields: [servers.organizationId],
		references: [organizations.id],
	}),
	sshKey: one(sshKeys, {
		fields: [servers.sshKeyId],
		references: [sshKeys.sshKeyId],
	}),
}));

export const insertSshKeySchema = createInsertSchema(sshKeys);
export const selectSshKeySchema = createSelectSchema(sshKeys);
export const insertServerSchema = createInsertSchema(servers);
export const selectServerSchema = createSelectSchema(servers);
export const insertWebServerSettingsSchema = createInsertSchema(webServerSettings);
export const selectWebServerSettingsSchema = createSelectSchema(webServerSettings);
