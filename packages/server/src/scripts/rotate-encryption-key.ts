#!/usr/bin/env tsx
/**
 * Re-encrypt every secret column with the PRIMARY encryption key.
 *
 *   ENCRYPTION_KEYS="<new>,<old>" DATABASE_URL=… pnpm nixploy:rotate-key
 *
 * The rotation window is `ENCRYPTION_KEYS`: the first entry encrypts, every
 * entry decrypts (see `lib/encryption.ts`). So the runbook is
 *
 *   1. put the new key FIRST and the current key second, restart the panel,
 *   2. run this script (it rewrites every row with the new key),
 *   3. drop the old key from `ENCRYPTION_KEYS`, restart again.
 *
 * Columns are discovered from the Drizzle schema rather than listed by hand:
 * `encryptedText` / `encryptedJson` are the only `customType` columns whose
 * SQL type is `text` (`service_log.search_vector` is the other custom column
 * and is a `tsvector`). Adding a new secret column therefore needs no change
 * here. Values are read and written as RAW driver strings — the customType's
 * own encrypt/decrypt hooks are bypassed on purpose, so a row that fails to
 * decrypt surfaces as an error instead of being silently rewritten.
 *
 * Each batch is one transaction; a failure rolls that batch back and stops.
 */
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { Sql } from "postgres";
import { client } from "../db";
import * as schema from "../db/schema";
import { decrypt, encrypt, encryptionKeyList, encryptionVersionOf } from "../lib/encryption";

interface SecretColumn {
	table: string;
	column: string;
	primaryKey: string;
}

interface Options {
	dryRun: boolean;
	batchSize: number;
	encryptPlaintext: boolean;
	/** Leave rows no configured key can read (a lost key) instead of aborting. */
	skipUndecryptable: boolean;
	only: string | null;
}

/** Every `encryptedText` / `encryptedJson` column in the schema. */
export function discoverSecretColumns(source: Record<string, unknown> = schema): SecretColumn[] {
	const found: SecretColumn[] = [];
	for (const value of Object.values(source)) {
		if (!is(value, PgTable)) continue;
		const table = getTableName(value);
		const columns = Object.values(getTableColumns(value)) as Array<{
			name: string;
			columnType: string;
			primary: boolean;
			getSQLType(): string;
		}>;
		const primaryKey = columns.find((column) => column.primary)?.name;
		if (!primaryKey) continue;
		for (const column of columns) {
			if (column.columnType !== "PgCustomColumn") continue;
			if (column.getSQLType() !== "text") continue;
			found.push({ table, column: column.name, primaryKey });
		}
	}
	return found.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

function parseOptions(argv: string[]): Options {
	const options: Options = {
		dryRun: argv.includes("--dry-run"),
		batchSize: 500,
		encryptPlaintext: argv.includes("--encrypt-plaintext"),
		skipUndecryptable: argv.includes("--skip-undecryptable"),
		only: null,
	};
	for (const arg of argv) {
		const batch = /^--batch-size=(\d+)$/.exec(arg);
		if (batch?.[1]) options.batchSize = Math.max(1, Number.parseInt(batch[1], 10));
		const only = /^--table=(.+)$/.exec(arg);
		if (only?.[1]) options.only = only[1];
	}
	return options;
}

interface ColumnStats {
	rows: number;
	rewritten: number;
	plaintext: number;
	undecryptable: number;
}

async function rotateColumn(
	sqlClient: Sql,
	target: SecretColumn,
	options: Options,
): Promise<ColumnStats> {
	const stats: ColumnStats = { rows: 0, rewritten: 0, plaintext: 0, undecryptable: 0 };
	let cursor: string | null = null;
	for (;;) {
		const batch: Array<Record<string, string>> = cursor
			? await sqlClient`
					select ${sqlClient(target.primaryKey)} as id, ${sqlClient(target.column)} as value
					from ${sqlClient(target.table)}
					where ${sqlClient(target.column)} is not null and ${sqlClient(target.primaryKey)} > ${cursor}
					order by ${sqlClient(target.primaryKey)}
					limit ${options.batchSize}`
			: await sqlClient`
					select ${sqlClient(target.primaryKey)} as id, ${sqlClient(target.column)} as value
					from ${sqlClient(target.table)}
					where ${sqlClient(target.column)} is not null
					order by ${sqlClient(target.primaryKey)}
					limit ${options.batchSize}`;
		if (batch.length === 0) break;
		cursor = batch[batch.length - 1]?.id ?? null;
		stats.rows += batch.length;

		const updates: Array<{ id: string; value: string }> = [];
		for (const row of batch) {
			const raw = row.value;
			const id = row.id;
			if (raw === undefined || id === undefined) continue;
			if (encryptionVersionOf(raw) === null) {
				stats.plaintext += 1;
				if (!options.encryptPlaintext) continue;
			}
			// Throws (loudly) when no configured key can authenticate the value —
			// name the row so the operator can decide: add the missing key to
			// ENCRYPTION_KEYS, or `--skip-undecryptable` past a dead one.
			let plaintext: string;
			try {
				plaintext = decrypt(raw);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (options.skipUndecryptable) {
					stats.undecryptable += 1;
					continue;
				}
				throw new Error(
					`${target.table}.${target.column} row ${id} cannot be decrypted with any configured key (${message}). ` +
						"Add the key that wrote it to ENCRYPTION_KEYS, or re-run with --skip-undecryptable to leave such rows untouched.",
				);
			}
			updates.push({ id, value: encrypt(plaintext) });
		}
		if (updates.length === 0) continue;
		stats.rewritten += updates.length;
		if (options.dryRun) continue;

		await sqlClient.begin(async (tx) => {
			for (const update of updates) {
				await tx`
					update ${tx(target.table)}
					set ${tx(target.column)} = ${update.value}
					where ${tx(target.primaryKey)} = ${update.id}`;
			}
		});
		if (process.stdout.isTTY) {
			// Live progress only on a terminal — a redirected log keeps just the
			// per-column summary below.
			process.stdout.write(
				`  ${target.table}.${target.column}: ${stats.rewritten} rewritten (${stats.rows} scanned)\r`,
			);
		}
	}
	return stats;
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const keys = encryptionKeyList();
	if (keys.length === 0) {
		throw new Error('Set ENCRYPTION_KEYS="<new>,<old>" (or ENCRYPTION_KEY) before rotating.');
	}
	if (!process.env.DATABASE_URL) {
		throw new Error("DATABASE_URL is not set.");
	}
	const columns = discoverSecretColumns().filter(
		(column) => !options.only || column.table === options.only,
	);

	console.log(
		`Rotating ${columns.length} secret column(s) across ${
			new Set(columns.map((column) => column.table)).size
		} table(s)`,
	);
	console.log(
		`Keys configured: ${keys.length} (the first one encrypts)${options.dryRun ? " — DRY RUN, nothing is written" : ""}`,
	);

	const totals = { rows: 0, rewritten: 0, plaintext: 0, undecryptable: 0 };
	for (const target of columns) {
		const stats = await rotateColumn(client, target, options);
		totals.rows += stats.rows;
		totals.rewritten += stats.rewritten;
		totals.plaintext += stats.plaintext;
		totals.undecryptable += stats.undecryptable;
		const notes = [
			stats.plaintext > 0 ? `${stats.plaintext} plaintext` : "",
			stats.undecryptable > 0 ? `${stats.undecryptable} undecryptable` : "",
		].filter(Boolean);
		console.log(
			`  ${target.table}.${target.column}: ${stats.rewritten}/${stats.rows} rewritten${
				notes.length > 0 ? `, ${notes.join(", ")}` : ""
			}`,
		);
	}
	console.log(
		`Done: ${totals.rewritten} value(s) re-encrypted, ${totals.rows} scanned, ${totals.plaintext} left as plaintext.`,
	);
	if (totals.undecryptable > 0) {
		console.log(
			`  WARNING: ${totals.undecryptable} value(s) could not be decrypted and were left as they are.`,
		);
	}
	if (totals.plaintext > 0 && !options.encryptPlaintext) {
		console.log(
			"  (pre-encryption plaintext rows were left alone — re-run with --encrypt-plaintext to encrypt them)",
		);
	}
	if (!options.dryRun) {
		console.log("Now drop the old key from ENCRYPTION_KEYS and restart the panel.");
	}
}

main()
	.then(async () => {
		await client.end({ timeout: 5 });
		process.exit(0);
	})
	.catch(async (error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		await client.end({ timeout: 5 }).catch(() => {});
		process.exit(1);
	});
