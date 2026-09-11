import type { Command } from "commander";

/**
 * Output contract shared by every command:
 *
 *   default   human-readable table / key-value / confirmation line
 *   --json    the raw API payload, nothing else (machine consumption)
 *   --quiet   only the identifying column of each row (ids for `xargs`),
 *             confirmations suppressed
 *
 * `--json` wins over `--quiet`. Both flags are declared on every leaf command
 * (commander only merges ancestor options through `optsWithGlobals`, and we
 * want `nixploy app list --json` to work as well as `nixploy --json app list`).
 */
export interface OutputMode {
	json: boolean;
	quiet: boolean;
}

let mode: OutputMode = { json: false, quiet: false };

export function setOutputMode(next: Partial<OutputMode>): void {
	mode = { json: Boolean(next.json), quiet: Boolean(next.quiet) };
}

export function outputMode(): OutputMode {
	return mode;
}

/** Attach `--json` / `--quiet` to a command (generated and hand-written alike). */
export function addOutputOptions(command: Command): Command {
	return command
		.option("--json", "Print the raw API payload as JSON")
		.option("--quiet", "Print only identifiers (scripting); suppress confirmations");
}

/** Print data as pretty JSON (used by --json flags). */
export function printJson(data: unknown): void {
	process.stdout.write(`${JSON.stringify(data, null, "\t")}\n`);
}

/** Bytes that must reach stdout verbatim (env dumps, compose files, logs). */
export function printRaw(text: string, { newline = true }: { newline?: boolean } = {}): void {
	process.stdout.write(text);
	if (newline && text.length > 0 && !text.endsWith("\n")) {
		process.stdout.write("\n");
	}
}

/** Minimal fixed-width table printer to avoid a dependency. */
export function printTable(rows: Record<string, unknown>[]): void {
	if (rows.length === 0) {
		process.stdout.write("No results.\n");
		return;
	}
	const columns = Object.keys(rows[0] as Record<string, unknown>);
	const widths = columns.map((column) =>
		Math.max(column.length, ...rows.map((row) => cell(row[column]).length)),
	);
	const formatRow = (values: string[]): string =>
		values
			.map((value, i) => value.padEnd(widths[i] ?? 0))
			.join("  ")
			.trimEnd();

	process.stdout.write(`${formatRow(columns)}\n`);
	process.stdout.write(`${formatRow(widths.map((width) => "-".repeat(width)))}\n`);
	for (const row of rows) {
		process.stdout.write(`${formatRow(columns.map((column) => cell(row[column])))}\n`);
	}
}

/** Stringify one cell: dates short, objects compact, nullish empty. */
function cell(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** Pick `columns` out of each row, preserving column order. */
export function pickColumns(list: unknown[], columns: string[]): Record<string, unknown>[] {
	return list.map((item) => {
		const record = (item ?? {}) as Record<string, unknown>;
		return Object.fromEntries(columns.map((column) => [column, record[column] ?? ""]));
	});
}

/** Render a list of objects: JSON, id-per-line, or a table of picked columns. */
export function printList(data: unknown, columns: string[]): void {
	if (mode.json) {
		printJson(data);
		return;
	}
	const list = Array.isArray(data) ? data : [data];
	if (mode.quiet) {
		const key = columns[0];
		if (!key) return;
		for (const item of list) {
			const value = (item as Record<string, unknown> | null)?.[key];
			if (value !== undefined && value !== null && value !== "") {
				process.stdout.write(`${cell(value)}\n`);
			}
		}
		return;
	}
	printTable(pickColumns(list, columns));
}

/** Render an array of scalars (object keys, service names, S3 keys) one per line. */
export function printValues(values: unknown[]): void {
	if (mode.json) {
		printJson(values);
		return;
	}
	if (values.length === 0) {
		if (!mode.quiet) process.stdout.write("No results.\n");
		return;
	}
	for (const value of values) {
		process.stdout.write(`${cell(value)}\n`);
	}
}

/** Render one object as aligned `key: value` lines (or JSON / its id). */
export function printRecord(data: unknown, columns?: string[]): void {
	if (mode.json) {
		printJson(data);
		return;
	}
	const record = (data ?? {}) as Record<string, unknown>;
	const keys = columns ?? Object.keys(record);
	if (mode.quiet) {
		const key = keys[0];
		if (key) printRaw(cell(record[key]));
		return;
	}
	const width = Math.max(0, ...keys.map((key) => key.length));
	for (const key of keys) {
		process.stdout.write(`${key.padEnd(width)}  ${cell(record[key])}\n`);
	}
}

/**
 * Result of a mutation: the payload under `--json`, a one-line confirmation
 * otherwise, nothing under `--quiet`.
 */
export function printResult(data: unknown, message: string): void {
	if (mode.json) {
		printJson(data ?? { ok: true });
		return;
	}
	if (mode.quiet) return;
	process.stdout.write(`${message}\n`);
}

/** Human-only note (suppressed by --json and --quiet). */
export function printMessage(message: string): void {
	if (mode.json || mode.quiet) return;
	process.stdout.write(`${message}\n`);
}

/** Warning on stderr — always shown so it never pollutes piped stdout. */
export function printWarning(message: string): void {
	process.stderr.write(`Warning: ${message}\n`);
}
