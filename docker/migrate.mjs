/**
 * Production migration runner. Lives next to its own node_modules in the
 * image (`/app/migrate-deps`) so it does not fight Next standalone deps.
 *
 * Connection-level failures (Postgres still booting, DNS not yet resolving
 * the service name) are retried for up to NIXPLOY_DB_WAIT_SECONDS (default
 * 60) — the entrypoint already waited with pg_isready, this covers the gap
 * between "accepting connections" and "ready for the migrator". A failing
 * migration itself is never retried: it exits 1 so Swarm rolls back.
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
const maxWaitMs =
	Math.max(0, Number.parseInt(process.env.NIXPLOY_DB_WAIT_SECONDS ?? "60", 10) || 0) * 1000;
const retryDelayMs = 3000;

/** Errors that mean "Postgres is not there yet", as opposed to a bad migration. */
const RETRYABLE_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ENOTFOUND",
	"EAI_AGAIN",
	"ETIMEDOUT",
	"CONNECT_TIMEOUT",
	"57P03", // cannot_connect_now (database system is starting up)
	"08001", // sqlclient_unable_to_establish_sqlconnection
	"08006", // connection_failure
]);

/**
 * drizzle wraps driver failures in DrizzleQueryError with the postgres-js
 * error on `cause`, so walk the chain before deciding.
 */
function isRetryable(error, depth = 0) {
	if (!error || typeof error !== "object" || depth > 5) return false;
	const code = error.code;
	if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
	const message = String(error.message ?? "");
	if (/starting up|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT/i.test(message)) {
		return true;
	}
	return isRetryable(error.cause, depth + 1);
}

/** One line for the retry log: the innermost cause is the useful part. */
function describe(error) {
	let current = error;
	while (current && typeof current === "object" && current.cause) current = current.cause;
	return String(current?.message ?? current ?? error).split("\n")[0];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startedAt = Date.now();
let attempt = 0;
for (;;) {
	attempt += 1;
	const client = postgres(url, { max: 1, connect_timeout: 10 });
	const db = drizzle(client);
	try {
		console.log(`Applying migrations from ${migrationsFolder}…`);
		await migrate(db, { migrationsFolder });
		console.log("Migrations applied.");
		await client.end();
		break;
	} catch (error) {
		await client.end({ timeout: 1 }).catch(() => {});
		const elapsed = Date.now() - startedAt;
		if (isRetryable(error) && elapsed + retryDelayMs <= maxWaitMs) {
			console.warn(
				`Postgres not reachable yet (attempt ${attempt}: ${describe(error)}) — retrying in ${retryDelayMs / 1000}s`,
			);
			await sleep(retryDelayMs);
			continue;
		}
		console.error("Migration failed:", error);
		process.exit(1);
	}
}
