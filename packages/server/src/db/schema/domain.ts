import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { encryptedText } from "../custom-columns";
import { applications } from "./application";
import { organizations } from "./auth";
import { compose } from "./compose";
import { previewDeployments } from "./deployment";
import {
	certificateType,
	domainMiddlewareKind,
	domainProtocol,
	domainTlsMode,
	domainType,
	portProtocol,
} from "./enums";
import { servers } from "./server";
import { createdAt, idColumn } from "./utils";

/** A Traefik route (router + service + TLS) attached to a service. */
export const domains = pgTable(
	"domain",
	{
		domainId: idColumn("domain_id"),
		host: text("host").notNull(),
		path: text("path").default("/"),
		/** Internal path prefix to forward to (path replacement). */
		internalPath: text("internal_path"),
		/** Container port the router forwards to. */
		port: integer("port"),
		/**
		 * Layer the router lives on. `http` (the default, and what every row
		 * created before migration 0026 is) keeps the existing HTTP behaviour;
		 * `tcp`/`udp` route raw streams on a named entrypoint instead.
		 */
		protocol: domainProtocol("protocol").notNull().default("http"),
		/**
		 * Traefik entrypoint name for `tcp`/`udp` rows (`traefik_entrypoint.name`,
		 * e.g. `pg-15432`). Always null for `http` rows, which use the built-in
		 * `web`/`websecure` entrypoints.
		 */
		entrypoint: text("entrypoint"),
		/** TCP TLS handling; `none` for plain TCP and for every UDP row. */
		tlsMode: domainTlsMode("tls_mode").notNull().default("none"),
		https: boolean("https").notNull().default(false),
		certificateType: certificateType("certificate_type").notNull().default("none"),
		customCertResolver: text("custom_cert_resolver"),
		/** Compose only: name of the compose service to route to. */
		serviceName: text("service_name"),
		domainType: domainType("domain_type").notNull().default("application"),
		uniqueConfigKey: text("unique_config_key").notNull().default(""),
		applicationId: text("application_id").references(() => applications.applicationId, {
			onDelete: "cascade",
		}),
		composeId: text("compose_id").references(() => compose.composeId, {
			onDelete: "cascade",
		}),
		previewDeploymentId: text("preview_deployment_id").references(
			() => previewDeployments.previewDeploymentId,
			{ onDelete: "cascade" },
		),
		certificateId: text("certificate_id"),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("domain_host_path_unique").on(table.host, table.path, table.port),
		index("domain_application_id_idx").on(table.applicationId),
		index("domain_compose_id_idx").on(table.composeId),
	],
);

/**
 * A Traefik middleware attached to one domain (rate limiting, IP allow-list,
 * headers, …). `config` is jsonb validated per kind by
 * `modules/traefik/middlewares.ts` on write AND on render; `order` decides the
 * position in the router's middleware chain (after redirects/basic-auth).
 */
export const domainMiddlewares = pgTable(
	"domain_middleware",
	{
		domainMiddlewareId: idColumn("domain_middleware_id"),
		domainId: text("domain_id")
			.notNull()
			.references(() => domains.domainId, { onDelete: "cascade" }),
		kind: domainMiddlewareKind("kind").notNull(),
		config: jsonb("config").notNull().default({}),
		order: integer("order").notNull().default(0),
		enabled: boolean("enabled").notNull().default(true),
		createdAt: createdAt(),
	},
	(table) => [index("domain_middleware_domain_id_idx").on(table.domainId)],
);

/**
 * An extra Traefik entrypoint (`tcp`/`udp`) for layer-4 routing.
 *
 * Instance-level and admin-managed: entrypoints live in Traefik's **static**
 * configuration, which is read once at start, and the port has to be
 * published by the `nixploy-traefik` swarm service — so every write here
 * recreates the proxy task (~9 s outage). `name` is rendered verbatim into
 * the static YAML, so it is restricted to `[a-z0-9-]` on write.
 */
export const traefikEntrypoints = pgTable(
	"traefik_entrypoint",
	{
		traefikEntrypointId: idColumn("traefik_entrypoint_id"),
		name: text("name").notNull(),
		port: integer("port").notNull(),
		protocol: portProtocol("protocol").notNull().default("tcp"),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("traefik_entrypoint_name_unique").on(table.name),
		uniqueIndex("traefik_entrypoint_port_unique").on(table.port, table.protocol),
	],
);

/** Manually uploaded TLS certificates. */
export const certificates = pgTable("certificate", {
	certificateId: idColumn("certificate_id"),
	name: text("name").notNull(),
	certificateData: text("certificate_data").notNull(),
	privateKey: encryptedText("private_key").notNull(),
	/** Path where the cert chain is written for Traefik's file provider. */
	certificatePath: text("certificate_path").notNull(),
	/**
	 * Warn before this certificate expires.
	 *
	 * This column used to be `auto_renew`, a toggle with **no consumer** — and
	 * one that could never have had one: these are certificates somebody pasted
	 * in, and Nixploy has no way to renew a PEM it did not issue. What an
	 * operator actually needs is to hear about it before it lapses, which is
	 * what this does. Defaults ON: a certificate that expires unnoticed is an
	 * outage, and the alert is an incident row, not a pager.
	 */
	expiryAlerts: boolean("expiry_alerts").notNull().default(true),
	/** `notAfter` parsed from the uploaded chain; NULL when it could not be read. */
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	/**
	 * Owning organization. Host certificates (`serverId` null) are written to
	 * the shared Traefik dynamic dir, so without this column they would be
	 * readable and deletable by every tenant on the instance.
	 */
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	serverId: text("server_id").references(() => servers.serverId, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

export const domainsRelations = relations(domains, ({ one, many }) => ({
	middlewares: many(domainMiddlewares),
	application: one(applications, {
		fields: [domains.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [domains.composeId],
		references: [compose.composeId],
	}),
	previewDeployment: one(previewDeployments, {
		fields: [domains.previewDeploymentId],
		references: [previewDeployments.previewDeploymentId],
	}),
	certificate: one(certificates, {
		fields: [domains.certificateId],
		references: [certificates.certificateId],
	}),
}));

export const domainMiddlewaresRelations = relations(domainMiddlewares, ({ one }) => ({
	domain: one(domains, {
		fields: [domainMiddlewares.domainId],
		references: [domains.domainId],
	}),
}));

export const certificatesRelations = relations(certificates, ({ one }) => ({
	server: one(servers, {
		fields: [certificates.serverId],
		references: [servers.serverId],
	}),
}));

export const insertTraefikEntrypointSchema = createInsertSchema(traefikEntrypoints);
export const selectTraefikEntrypointSchema = createSelectSchema(traefikEntrypoints);
export const insertDomainSchema = createInsertSchema(domains);
export const selectDomainSchema = createSelectSchema(domains);
export const insertCertificateSchema = createInsertSchema(certificates);
export const selectCertificateSchema = createSelectSchema(certificates);
export const insertDomainMiddlewareSchema = createInsertSchema(domainMiddlewares);
export const selectDomainMiddlewareSchema = createSelectSchema(domainMiddlewares);
