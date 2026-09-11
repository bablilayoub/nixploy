import { Command } from "commander";
import { apiGet } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printList, printRaw, printResult } from "../utils/output.js";

/**
 * Audit log reader. Every filter — action, target type, free-text search and
 * the `--since` / `--until` window — is a server-side predicate on
 * `audit.all`, so a window wider than `--limit` rows no longer silently drops
 * the older half (it used to be filtered client-side over the fetched page).
 */

interface AuditRow {
	auditId?: string;
	action: string;
	targetType: string | null;
	targetName: string | null;
	actorEmail?: string | null;
	ip?: string | null;
	createdAt: string;
}

/**
 * Accepts an ISO timestamp or a relative `30m` / `24h` / `7d` window.
 *
 * The panel parses the same two shapes (`trpc/routers/audit.ts`), so the value
 * could be forwarded verbatim; parsing locally first turns a typo into a usage
 * error (exit 2) instead of a 400 round trip, and pins "now" to the caller's
 * clock rather than the panel's.
 */
export function parseSince(value: string, now = new Date(), flag = "--since"): Date {
	const relative = /^(\d+)([mhd])$/.exec(value.trim());
	if (relative) {
		const amount = Number(relative[1]);
		const unit = relative[2];
		const ms = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
		return new Date(now.getTime() - amount * ms);
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw usageError(`${flag} expects an ISO date or a window like 30m, 24h, 7d (got "${value}")`);
	}
	return parsed;
}

export function auditCommand(): Command {
	const audit = new Command("audit").description("Read the organization audit log");

	addOutputOptions(
		audit
			.command("list")
			.description("List audit events (newest first)")
			.option("--since <when>", "ISO date or relative window: 30m, 24h, 7d")
			.option("--until <when>", "Upper bound, same formats as --since")
			.option("--action <action>", "Exact action, e.g. application.deploy")
			.option("--target-type <type>", "Target type, e.g. application")
			.option("--search <text>", "Free-text search over target names")
			.option("--limit <n>", "Rows to fetch (default 50)")
			.option("--offset <n>", "Rows to skip"),
	).action(
		async (options: {
			since?: string;
			until?: string;
			action?: string;
			targetType?: string;
			search?: string;
			limit?: string;
			offset?: string;
		}) => {
			const limit = options.limit ? Number(options.limit) : undefined;
			const offset = options.offset ? Number(options.offset) : undefined;
			if (
				(limit !== undefined && !Number.isFinite(limit)) ||
				(offset !== undefined && !Number.isFinite(offset))
			) {
				throw usageError("--limit and --offset expect numbers");
			}
			// Normalised to ISO here so the panel filters on an instant, not on a
			// relative window resolved against its own clock.
			const since = options.since ? parseSince(options.since).toISOString() : undefined;
			const until = options.until
				? parseSince(options.until, new Date(), "--until").toISOString()
				: undefined;
			const page = await apiGet<{ events?: AuditRow[]; rows?: AuditRow[] } | AuditRow[]>(
				"audit.all",
				{
					action: options.action,
					targetType: options.targetType,
					search: options.search,
					since,
					until,
					limit,
					offset,
				},
			);
			const rows = Array.isArray(page) ? page : ((page.events ?? page.rows ?? []) as AuditRow[]);
			printList(rows, ["createdAt", "action", "targetType", "targetName", "actorEmail", "ip"]);
		},
	);

	addOutputOptions(
		audit
			.command("export")
			.description("Export the audit trail as CSV (stdout, or --output <file>)")
			.option("--output <file>", "Write the CSV to this file instead of stdout")
			.option("--since <when>", "ISO date or relative window: 30m, 24h, 7d")
			.option("--until <when>", "Upper bound, same formats as --since")
			.option("--action <action>", "Exact action, e.g. application.deploy")
			.option("--target-type <type>", "Target type, e.g. application")
			.option("--search <text>", "Free-text search over target names")
			.option("--limit <n>", "Rows to export (default 5000, max 10000)"),
	).action(
		async (options: {
			output?: string;
			since?: string;
			until?: string;
			action?: string;
			targetType?: string;
			search?: string;
			limit?: string;
		}) => {
			const limit = options.limit ? Number(options.limit) : undefined;
			if (limit !== undefined && !Number.isFinite(limit)) {
				throw usageError("--limit expects a number");
			}
			const result = await apiGet<{ filename: string; rows: number; csv: string }>("audit.export", {
				action: options.action,
				targetType: options.targetType,
				search: options.search,
				since: options.since ? parseSince(options.since).toISOString() : undefined,
				until: options.until
					? parseSince(options.until, new Date(), "--until").toISOString()
					: undefined,
				limit,
			});
			if (options.output) {
				const { writeFile } = await import("node:fs/promises");
				await writeFile(options.output, result.csv, "utf8");
				printResult(
					{ file: options.output, rows: result.rows },
					`Wrote ${result.rows} audit ${result.rows === 1 ? "row" : "rows"} to ${options.output}`,
				);
				return;
			}
			printRaw(result.csv);
		},
	);

	addOutputOptions(
		audit.command("facets").description("Distinct actions and target types for filtering"),
	).action(async () => {
		const facets = await apiGet<Record<string, unknown>>("audit.facets");
		printList(
			Object.entries(facets).map(([facet, values]) => ({
				facet,
				values: Array.isArray(values) ? values.join(", ") : String(values),
			})),
			["facet", "values"],
		);
	});

	return audit;
}
