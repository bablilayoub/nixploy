/**
 * A drizzle-shaped test double for `src/db`.
 *
 * Eleven suites hand-rolled a variant of this before it existed (audit F8) —
 * `modules/deployment/worker.test.ts` and `modules/preview/index.test.ts` both
 * reinvented the `Symbol.for("drizzle:Name")` table-name extractor. Use it as:
 *
 * ```ts
 * const fake = vi.hoisted(() => createFakeDb({ … }));
 * vi.mock("../../db", () => ({ db: fake.db }));
 * ```
 *
 * Reads answer from `query` / `select`; writes are recorded on `writes` (and
 * can be refused through `onWrite`, which is how the capability matrix test
 * proves a rejected mutation never reached the database).
 */

/** Drizzle stamps every table object with its SQL name under this symbol. */
export const drizzleTableName = (table: unknown): string =>
	String((table as Record<PropertyKey, unknown> | null)?.[Symbol.for("drizzle:Name")] ?? "unknown");

/**
 * Literal values bound in a drizzle `where` clause, in order — so a fake
 * `findFirst` can answer "which row was asked for?" without a real database:
 *
 * ```ts
 * findFirst: (args) => rows.get(whereValues(args)[0] as string)
 * ```
 *
 * Best effort over `eq()` / `and()` / `inArray()` trees: it walks
 * `queryChunks` and keeps the bound `Param` values (column references and the
 * literal SQL fragments around them carry no scalar value).
 */
export function whereValues(node: unknown): unknown[] {
	const found: unknown[] = [];
	const walk = (current: unknown): void => {
		if (!current || typeof current !== "object") return;
		const record = current as Record<string, unknown>;
		if (Array.isArray(record.queryChunks)) {
			for (const chunk of record.queryChunks) walk(chunk);
			return;
		}
		if (record.where !== undefined) {
			walk(record.where);
			return;
		}
		if (!("value" in record)) return;
		const value = record.value;
		// `StringChunk.value` is an array of SQL fragments; a column has none.
		if (value === undefined || Array.isArray(value)) return;
		found.push(value);
	};
	walk(node);
	return found;
}

export type FakeWriteOp = "insert" | "update" | "delete" | "execute";

export interface FakeWrite {
	op: FakeWriteOp;
	/** SQL table name, or `"(raw)"` for `db.execute(sql\`…\`)`. */
	table: string;
	/** The object passed to `.values()` (insert) or `.set()` (update). */
	values?: Record<string, unknown>;
}

export interface FakeTableQueries {
	findFirst?: (...args: unknown[]) => unknown;
	findMany?: (...args: unknown[]) => unknown;
}

export interface FakeDbOptions {
	/** Relational-query answers per table: `{ applications: { findFirst: … } }`. */
	query?: Record<string, FakeTableQueries>;
	/** Rows every `db.select()…` chain resolves with (default `[]`). */
	select?: (fields?: unknown) => unknown[] | Promise<unknown[]>;
	/** Rows an insert/update `.returning()` resolves with (default `[]`). */
	returning?: (write: FakeWrite) => unknown[];
	/**
	 * Runs before a write is recorded. Throw to make every mutation fail loudly
	 * — `expect(fake.writes).toEqual([])` then proves the code path stopped
	 * before touching the database.
	 */
	onWrite?: (write: FakeWrite) => void;
}

// The double is deliberately structural: callers hand it to `vi.mock` in place
// of a drizzle instance whose real type would need the whole schema.
// biome-ignore lint/suspicious/noExplicitAny: test double for a drizzle client
type AnyChain = any;

/**
 * A thenable that answers any method with another thenable, so every drizzle
 * builder shape (`.from().where().orderBy().limit()`, `.values().returning()`,
 * `.set().where()`) works without enumerating them.
 */
function chain(
	resolve: () => Promise<unknown[]>,
	onCall?: (method: string, args: unknown[]) => void,
): AnyChain {
	return new Proxy(() => {}, {
		get(_target, prop) {
			if (prop === "then") {
				const promise = resolve();
				return promise.then.bind(promise);
			}
			if (prop === "catch" || prop === "finally") {
				const promise = resolve();
				return (promise[prop] as (...args: unknown[]) => unknown).bind(promise);
			}
			return (...args: unknown[]) => {
				onCall?.(String(prop), args);
				return chain(resolve, onCall);
			};
		},
		apply() {
			return chain(resolve, onCall);
		},
	});
}

export interface FakeDb {
	/** Pass this where the real `db` is imported. */
	db: AnyChain;
	/** Every write attempted, in order. */
	writes: FakeWrite[];
	/** Clear the recorded writes (call it from `beforeEach`). */
	reset(): void;
}

export function createFakeDb(options: FakeDbOptions = {}): FakeDb {
	const writes: FakeWrite[] = [];

	const rows = async (fields?: unknown): Promise<unknown[]> =>
		(await options.select?.(fields)) ?? [];

	const startWrite = (op: FakeWriteOp, table: unknown): FakeWrite => {
		const write: FakeWrite = { op, table: drizzleTableName(table) };
		options.onWrite?.(write);
		writes.push(write);
		return write;
	};

	const writeChain = (write: FakeWrite, valueMethod?: "values" | "set"): AnyChain =>
		chain(
			async () => options.returning?.(write) ?? [],
			(method, args) => {
				if (valueMethod && method === valueMethod) {
					write.values = args[0] as Record<string, unknown>;
				}
			},
		);

	const query = new Proxy({} as Record<string, Required<FakeTableQueries>>, {
		get(_target, prop) {
			const table = options.query?.[String(prop)];
			return {
				findFirst: (...args: unknown[]) => table?.findFirst?.(...args) ?? undefined,
				findMany: (...args: unknown[]) => table?.findMany?.(...args) ?? [],
			};
		},
	});

	const db: AnyChain = {
		query,
		select: (fields?: unknown) => chain(() => rows(fields)),
		selectDistinct: (fields?: unknown) => chain(() => rows(fields)),
		insert: (table: unknown) => writeChain(startWrite("insert", table), "values"),
		update: (table: unknown) => writeChain(startWrite("update", table), "set"),
		delete: (table: unknown) => writeChain(startWrite("delete", table)),
		execute: async (...args: unknown[]) => {
			const write: FakeWrite = { op: "execute", table: "(raw)", values: { sql: args[0] } };
			options.onWrite?.(write);
			writes.push(write);
			return [];
		},
		// Savepoint semantics do not matter to a double: run the callback with
		// the same handle so writes still land on `writes`.
		transaction: async (fn: (tx: unknown) => unknown) => await fn(db),
	};

	return {
		db,
		writes,
		reset: () => {
			writes.length = 0;
		},
	};
}
