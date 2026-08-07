import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type SqlClient = postgres.Sql;
type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Next.js HMR re-evaluates this module constantly in `pnpm dev`. A plain
 * module-level singleton is wiped on each reload while the previous
 * postgres-js pool stays open → "sorry, too many clients already".
 * Stash both the raw client and drizzle on globalThis so reloads reuse them.
 */
const globalForDb = globalThis as typeof globalThis & {
	__nixploySql?: SqlClient;
	__nixployDb?: Db;
};

function getDatabaseUrl(): string {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error(
			"DATABASE_URL environment variable is not set. " +
				"Example: postgres://nixploy:nixploy@localhost:5432/nixploy",
		);
	}
	return databaseUrl;
}

function poolMax(): number {
	const raw = process.env.DATABASE_POOL_MAX;
	if (raw) {
		const parsed = Number.parseInt(raw, 10);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	// Dev: keep the pool tiny — HMR + custom server + browsers hammer Postgres.
	return process.env.NODE_ENV === "production" ? 10 : 3;
}

function createSql(url: string): SqlClient {
	return postgres(url, {
		max: poolMax(),
		prepare: false,
		idle_timeout: 20,
		max_lifetime: 60 * 30,
	});
}

function ensureDb(): Db {
	if (globalForDb.__nixployDb && globalForDb.__nixploySql) {
		return globalForDb.__nixployDb;
	}
	const sql = createSql(getDatabaseUrl());
	const next = drizzle(sql, { schema });
	globalForDb.__nixploySql = sql;
	globalForDb.__nixployDb = next;
	return next;
}

function ensureSql(): SqlClient {
	ensureDb();
	return globalForDb.__nixploySql as SqlClient;
}

/**
 * Lazily-initialized drizzle client. Importing this module never throws and
 * never opens a connection — the first query does. This keeps Next.js build
 * (page-data collection) working without a live DATABASE_URL.
 */
export const db: Db = new Proxy({} as Db, {
	get(_target, prop) {
		const instance = ensureDb();
		const value = Reflect.get(instance, prop);
		return typeof value === "function" ? value.bind(instance) : value;
	},
}) as Db;

/** Raw postgres-js client (exported for one-off queries / health checks). */
export const client: SqlClient = new Proxy((() => {}) as unknown as SqlClient, {
	apply(_target, _thisArg, args) {
		const sql = ensureSql();
		return (sql as unknown as (...a: unknown[]) => unknown)(...args);
	},
	get(_target, prop) {
		const sql = ensureSql();
		const value = Reflect.get(sql, prop);
		return typeof value === "function" ? value.bind(sql) : value;
	},
}) as SqlClient;

export { schema };
export type Database = Db;
