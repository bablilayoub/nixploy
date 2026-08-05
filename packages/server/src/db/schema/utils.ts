import { randomUUID } from "node:crypto";
import { text, timestamp } from "drizzle-orm/pg-core";

export const generateId = (): string => randomUUID();

/** Standard primary key: `text` column with a UUID default. */
export const idColumn = (column: string) => text(column).primaryKey().$defaultFn(generateId);

/** Standard creation timestamp. */
export const createdAt = () =>
	timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Standard update timestamp (bumped by application code, not a DB trigger). */
export const updatedAt = () =>
	timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
