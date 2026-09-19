import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { environments } from "./project";
import { createdAt, idColumn } from "./utils";

/**
 * An HTTP origin that lives outside the Swarm — the old panel's box, a SaaS
 * endpoint, a static host — fronted by Traefik as if it were a service:
 * domains, Let's Encrypt, middlewares and uptime probes all attach to it the
 * same way. The point is migration order: DNS moves to Nixploy once, and the
 * workloads follow one at a time instead of in a big-bang cutover.
 *
 * `appName` shares the service namespace (`modules/services/app-name.ts`)
 * because it names the Traefik file. `targetUrl` is an origin only — the
 * path rewrite lives on the domain row (`internalPath`), where every other
 * kind keeps it. `blockedReason` is set by the hourly re-check when the host
 * stops passing the egress policy (a name re-pointed at the overlay after it
 * was saved); the route is withheld until it passes again or is edited.
 */
export const externalUpstreams = pgTable(
	"external_upstream",
	{
		externalUpstreamId: idColumn("external_upstream_id"),
		name: text("name").notNull(),
		appName: text("app_name").notNull(),
		description: text("description"),
		/** `http(s)://host[:port]` — validated by `modules/upstreams/target.ts`. */
		targetUrl: text("target_url").notNull(),
		/** Forward the public `Host` (a reverse-proxied app) or send the target's own (a SaaS origin). */
		passHostHeader: boolean("pass_host_header").notNull().default(true),
		/** Skip TLS verification of the target — self-signed origins only. */
		insecureSkipVerify: boolean("insecure_skip_verify").notNull().default(false),
		blockedReason: text("blocked_reason"),
		environmentId: text("environment_id")
			.notNull()
			.references(() => environments.environmentId, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("external_upstream_app_name_unique").on(table.appName),
		index("external_upstream_environment_id_idx").on(table.environmentId),
	],
);

export const insertExternalUpstreamSchema = createInsertSchema(externalUpstreams);
export const selectExternalUpstreamSchema = createSelectSchema(externalUpstreams);
export type ExternalUpstream = typeof externalUpstreams.$inferSelect;
