/**
 * Apply Drizzle SQL migrations then exit.
 * Used by the production container entrypoint before starting the app.
 *
 *   DATABASE_URL=... node --import tsx packages/server/src/db/migrate.ts
 *   # or compiled / bundled as apps/web/migrate.mjs in the image
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL is required to run migrations");
	process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
	process.env.NIXPLOY_MIGRATIONS_DIR ?? path.resolve(here, "../../../drizzle");

const client = postgres(url, { max: 1 });
const db = drizzle(client);

try {
	console.log(`Applying migrations from ${migrationsFolder}…`);
	await migrate(db, { migrationsFolder });
	console.log("Migrations applied.");
} catch (error) {
	console.error("Migration failed:", error);
	process.exit(1);
} finally {
	await client.end();
}
