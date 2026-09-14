/**
 * Maintenance against a real Postgres.
 *
 * The offline `maintenance.test.ts` mocks `db.execute`, so it asserts the SQL
 * text and nothing about whether the driver accepts it. That gap let a broken
 * parameter ship: `pruneDeploymentRows` passed a JS `Date` into a raw
 * statement, postgres-js refused it with ERR_INVALID_ARG_TYPE, and the hourly
 * pass failed on every install while the unit test stayed green. This suite
 * runs the statements for real, which is the only thing that catches that.
 *
 * Requires `DATABASE_URL_TEST` (a throwaway, migrated database) and skips
 * without it, like the other `.db.test.ts` suites.
 */

import { describe, expect, it } from "vitest";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("maintenance (postgres)", () => {
	it("runs every pruning statement against the driver", async () => {
		process.env.DATABASE_URL = testUrl;
		const maintenance = await import("./maintenance");

		// Each one executes raw or built SQL; a rejected promise here means the
		// statement never reaches the database in production either.
		await expect(maintenance.pruneDeploymentRows()).resolves.toMatchObject({
			rows: expect.any(Number),
			files: expect.any(Number),
		});
		await expect(maintenance.pruneIncidents()).resolves.toEqual(expect.any(Number));
		await expect(maintenance.pruneAuditLogs()).resolves.toEqual(expect.any(Number));
		await expect(maintenance.findOrphanDeploymentIds([])).resolves.toBeInstanceOf(Set);
	});
});
