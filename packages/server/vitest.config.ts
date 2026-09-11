import { configDefaults, defineConfig } from "vitest/config";

/**
 * Two projects, one command.
 *
 * `unit` — pure/logic-heavy modules with mocked boundaries. Runs in parallel.
 *
 * `db` — the suites that talk to a real Postgres (`DATABASE_URL_TEST`; they
 * `describe.skipIf` themselves when it is unset, which keeps the default run
 * offline). They all share ONE database, and their claim/visibility semantics
 * are database-wide by design (see the note in
 * `modules/deployment/queue.db.test.ts`), so two of them running at the same
 * time flakes: the durable-queue file sees rows the tags/tenancy fixtures just
 * inserted. `fileParallelism: false` is the fix — the files run one after the
 * other inside the project; the `unit` project still runs in parallel
 * alongside them.
 *
 * Add a new Postgres-backed suite as `<name>.db.test.ts` and it joins the
 * serialized project automatically.
 */

/** Deterministic key for encryption tests (never a real secret). */
const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** Every file that must not share `nixploy_test` with another file. */
const DB_BACKED = ["src/**/*.db.test.ts", "src/trpc/tenancy.test.ts"];

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					exclude: [...configDefaults.exclude, ...DB_BACKED],
					environment: "node",
					env: { ENCRYPTION_KEY },
				},
			},
			{
				test: {
					name: "db",
					include: DB_BACKED,
					exclude: [...configDefaults.exclude],
					environment: "node",
					env: { ENCRYPTION_KEY },
					// One database, one file at a time.
					fileParallelism: false,
				},
			},
		],
	},
});
