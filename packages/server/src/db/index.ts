import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _client: postgres.Sql | null = null;
let _db: ReturnType<typeof createDb> | null = null;

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

function createDb(url: string) {
	const poolMaxRaw = process.env.DATABASE_POOL_MAX;
	const poolMax = poolMaxRaw ? Number.parseInt(poolMaxRaw, 10) : 10;
	_client = postgres(url, {
		max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
		prepare: false,
	});
	return drizzle(_client, { schema });
}

type Db = ReturnType<typeof createDb>;

/**
 * Lazily-initialized drizzle client. Importing this module never throws and
 * never opens a connection — the first query does. This keeps Next.js build
 * (page-data collection) working without a live DATABASE_URL.
 */
export const db: Db = new Proxy({} as Db, {
	get(_target, prop) {
		if (!_db) {
			_db = createDb(getDatabaseUrl());
		}
		const value = Reflect.get(_db, prop);
		return typeof value === "function" ? value.bind(_db) : value;
	},
}) as Db;

/** Raw postgres-js client (exported for one-off queries / health checks). */
export const client: postgres.Sql = new Proxy((() => {}) as unknown as postgres.Sql, {
	// postgres-js clients are called as template tags: client`SELECT ...`
	apply(_target, _thisArg, args) {
		if (!_client) {
			if (!_db) {
				_db = createDb(getDatabaseUrl());
			}
		}
		return (_client as unknown as (...a: unknown[]) => unknown)(...args);
	},
	get(_target, prop) {
		if (!_client) {
			if (!_db) {
				_db = createDb(getDatabaseUrl());
			}
		}
		const value = Reflect.get(_client as postgres.Sql, prop);
		return typeof value === "function" ? value.bind(_client) : value;
	},
}) as postgres.Sql;

export { schema };
export type Database = Db;
