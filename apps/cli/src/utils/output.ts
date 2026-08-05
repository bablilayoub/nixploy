/** Print data as pretty JSON (used by --json flags). */
export function printJson(data: unknown): void {
	process.stdout.write(`${JSON.stringify(data, null, "\t")}\n`);
}

/** Minimal fixed-width table printer to avoid a dependency. */
export function printTable(rows: Record<string, unknown>[]): void {
	if (rows.length === 0) {
		process.stdout.write("No results.\n");
		return;
	}
	const columns = Object.keys(rows[0] as Record<string, unknown>);
	const widths = columns.map((column) =>
		Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
	);
	const formatRow = (values: string[]): string =>
		values
			.map((value, i) => value.padEnd(widths[i] ?? 0))
			.join("  ")
			.trimEnd();

	process.stdout.write(`${formatRow(columns)}\n`);
	process.stdout.write(`${formatRow(widths.map((width) => "-".repeat(width)))}\n`);
	for (const row of rows) {
		process.stdout.write(`${formatRow(columns.map((column) => String(row[column] ?? "")))}\n`);
	}
}

/** Render a list of objects either as JSON or as a table of picked columns. */
export function printList(data: unknown, columns: string[], options: { json?: boolean }): void {
	if (options.json) {
		printJson(data);
		return;
	}
	const list = Array.isArray(data) ? data : [data];
	printTable(
		list.map((item) => {
			const record = item as Record<string, unknown>;
			return Object.fromEntries(columns.map((c) => [c, record[c] ?? ""]));
		}),
	);
}
