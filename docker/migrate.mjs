/**
 * Production migration runner. Lives next to its own node_modules in the
 * image (`/app/migrate-deps`) so it does not fight Next standalone deps.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL is required to run migrations");
	process.exit(1);
}

const migrationsFolder = process.env.NIXPLOY_MIGRATIONS_DIR ?? "/app/drizzle";
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
