#!/usr/bin/env node
/**
 * `pnpm test:db` — the *full* vitest run, Postgres-backed suites included.
 *
 * Why it exists (audit ops-dx #20): `pnpm test` is green with zero database.
 * The tenancy-isolation, durable-queue and tag-transaction suites
 * `describe.skipIf(!DATABASE_URL_TEST)` themselves, so a forgotten env var
 * silently turns "all tests pass" into "the tests that prove tenant isolation
 * did not run". This script refuses to run at all in that state, and prints
 * the skipped-test inventory of the runs it does perform.
 *
 *   DATABASE_URL_TEST=postgres://nixploy:nixploy@127.0.0.1:54329/nixploy_test pnpm test:db
 *
 * Extra arguments are forwarded to vitest:
 *   pnpm test:db src/trpc/tenancy.test.ts
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverDir = join(repoRoot, "packages", "server");

/** Kept in sync with CLAUDE.md and docs/development.md. */
const SUGGESTED_URL = "postgres://nixploy:nixploy@127.0.0.1:54329/nixploy_test";

if (!process.env.DATABASE_URL_TEST) {
	process.stderr.write(
		[
			"",
			"  ✖ DATABASE_URL_TEST is not set — refusing to run.",
			"",
			"    `pnpm test:db` exists so the Postgres-backed suites (tenant isolation,",
			"    durable deploy queue, tag transactions) cannot skip unnoticed. Use",
			"    `pnpm test` for the offline run.",
			"",
			"    Local dev database (docker container `nixploy-dev-pg`, see CLAUDE.md):",
			"",
			`      docker start nixploy-dev-pg   # if it is not running`,
			`      createdb -h 127.0.0.1 -p 54329 -U nixploy nixploy_test   # once`,
			`      DATABASE_URL=${SUGGESTED_URL} pnpm db:migrate`,
			"",
			`      DATABASE_URL_TEST=${SUGGESTED_URL} pnpm test:db`,
			"",
		].join("\n"),
	);
	process.exit(1);
}

const jsonDir = mkdtempSync(join(tmpdir(), "nixploy-test-db-"));
const jsonPath = join(jsonDir, "results.json");

const args = [
	"run",
	"--reporter=verbose",
	"--reporter=json",
	`--outputFile.json=${jsonPath}`,
	...process.argv.slice(2),
];

const vitest = spawnSync(join(serverDir, "node_modules", ".bin", "vitest"), args, {
	cwd: serverDir,
	stdio: "inherit",
	env: process.env,
});

/**
 * Skipped tests are the point of this script: print them as a flat list so a
 * suite that quietly stopped running is visible without reading the whole
 * verbose log. Never fails the run on its own — the vitest exit code decides.
 */
function reportSkipped() {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
	} catch {
		process.stdout.write("\n  (no JSON report — skipped-test summary unavailable)\n");
		return;
	}
	const skipped = [];
	for (const file of parsed.testResults ?? []) {
		for (const test of file.assertionResults ?? []) {
			if (test.status === "pending" || test.status === "todo" || test.status === "skipped") {
				skipped.push(`${file.name?.replace(repoRoot, "") ?? "?"} › ${test.fullName}`);
			}
		}
	}
	process.stdout.write(
		skipped.length === 0
			? "\n  Skipped tests: none — every suite ran.\n"
			: `\n  Skipped tests (${skipped.length}):\n${skipped.map((line) => `    · ${line}`).join("\n")}\n`,
	);
	if (skipped.some((line) => /tenant isolation|deploy queue|setServiceTags/i.test(line))) {
		process.stdout.write(
			"\n  ⚠ A Postgres-backed suite skipped even though DATABASE_URL_TEST is set.\n" +
				"    Check that the database exists and `pnpm db:migrate` ran against it.\n",
		);
	}
}

reportSkipped();
rmSync(jsonDir, { recursive: true, force: true });

process.exit(vitest.status ?? 1);
