import {
	compareRuntimeLogCursors,
	decodeRuntimeLogCursor,
	encodeRuntimeLogCursor,
	type RuntimeLogCursor,
} from "./cursor";
import type { RuntimeLogLine } from "./format";
import type { LogQuery } from "./query";
import { DEFAULT_MAX_SCANNED, DEFAULT_READ_BUDGET_MS, readRuntimeLogs } from "./store";

/** Merge only the range every service has scanned, including timestamp ties. */
export async function readMergedRuntimeLogs(input: {
	appNames: readonly string[];
	query?: LogQuery | null;
	cursor?: string | null;
	before?: number | null;
	since?: number;
	until?: number;
	limit: number;
	maxScanned?: number;
}) {
	const cursor = input.cursor ? decodeRuntimeLogCursor(input.cursor) : null;
	const names = [...new Set(input.appNames)].sort();
	const entries: Array<{ line: RuntimeLogLine & { appName: string }; position: RuntimeLogCursor }> =
		[];
	let frontier: RuntimeLogCursor | null = null;
	let truncated = false;
	let scanned = 0;
	for (const appName of names) {
		// Services sort alphabetically within one timestamp. A service before
		// the cursor has consumed that timestamp; one after it has not.
		let serviceCursor: string | null = null;
		let before = input.before ?? null;
		if (cursor) {
			if (appName < cursor.appName) before = cursor.t;
			else
				serviceCursor = encodeRuntimeLogCursor({
					t: cursor.t,
					appName,
					index: appName === cursor.appName ? cursor.index : Number.MAX_SAFE_INTEGER,
				});
		}
		const page = await readRuntimeLogs({
			appName,
			query: input.query,
			cursor: serviceCursor,
			before,
			since: input.since,
			until: input.until,
			limit: input.limit + 1,
			// Give every service a scan opportunity; an unvisited service cannot
			// be silently treated as exhausted when an earlier reader is slow.
			budgetMs: Math.max(1, Math.floor(DEFAULT_READ_BUDGET_MS / Math.max(names.length, 1))),
			maxScanned: Math.max(
				1,
				Math.floor((input.maxScanned ?? DEFAULT_MAX_SCANNED) / Math.max(names.length, 1)),
			),
		});
		scanned += page.scanned;
		truncated ||= page.truncated;
		page.lines.forEach((line, index) => {
			const token = page.lineCursors[index];
			if (token)
				entries.push({ line: { ...line, appName }, position: decodeRuntimeLogCursor(token) });
		});
		if (page.nextPageCursor) {
			const position = decodeRuntimeLogCursor(page.nextPageCursor);
			if (!frontier || compareRuntimeLogCursors(position, frontier) < 0) frontier = position;
		}
	}
	entries.sort((a, b) => compareRuntimeLogCursors(a.position, b.position));
	const covered = frontier
		? entries.filter(
				(entry) => compareRuntimeLogCursors(entry.position, frontier as RuntimeLogCursor) <= 0,
			)
		: entries;
	const page = covered.slice(0, input.limit);
	const next = covered.length > input.limit ? (page.at(-1)?.position ?? frontier) : frontier;
	return {
		lines: page.map((entry) => entry.line),
		// Keep the old numeric cursor for existing REST/CLI clients. New clients
		// use nextPageCursor so a millisecond boundary never discards siblings.
		nextCursor: next?.t ?? null,
		nextPageCursor: next ? encodeRuntimeLogCursor(next) : null,
		truncated,
		scanned,
	};
}
