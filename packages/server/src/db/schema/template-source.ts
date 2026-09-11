import { relations } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organizations } from "./auth";
import { createdAt, idColumn } from "./utils";

/**
 * Where a remote template catalog comes from.
 * - `http-json`: one JSON document — either an array of `Template` objects or
 *   `{ templates: [...] }` — fetched through the egress guard.
 * - `git`: a shallow clone whose `templates/index.json` has that same shape.
 *
 * Declared next to its table rather than in `enums.ts` so the whole feature
 * lands in files this change owns; move it over when `enums.ts` is next
 * touched.
 */
export const templateSourceKind = pgEnum("template_source_kind", ["git", "http-json"]);

/**
 * An organization's own template catalog (product audit, Platform row
 * "Templates are a fixed TS catalog"). Entries are validated, image-probed
 * and cached to `<config>/templates/sources/<id>.json` by
 * `modules/templates/sources.ts`; the cache is merged into the built-in
 * catalog for that organization only.
 */
export const templateSources = pgTable(
	"template_source",
	{
		templateSourceId: idColumn("template_source_id"),
		name: text("name").notNull(),
		/** https URL (http only when the instance allows private egress). */
		url: text("url").notNull(),
		kind: templateSourceKind("kind").notNull().default("http-json"),
		/** Branch for `git` sources; null means the remote's default branch. */
		branch: text("branch"),
		enabled: boolean("enabled").notNull().default(true),
		lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
		/** Failure of the last sync, cleared on the next success. */
		lastError: text("last_error"),
		/** Templates in the cache after the last successful sync. */
		templateCount: integer("template_count").notNull().default(0),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(table) => [index("template_source_organization_id_idx").on(table.organizationId)],
);

export const templateSourcesRelations = relations(templateSources, ({ one }) => ({
	organization: one(organizations, {
		fields: [templateSources.organizationId],
		references: [organizations.id],
	}),
}));

export const insertTemplateSourceSchema = createInsertSchema(templateSources);
export const selectTemplateSourceSchema = createSelectSchema(templateSources);
export type TemplateSourceRow = typeof templateSources.$inferSelect;
