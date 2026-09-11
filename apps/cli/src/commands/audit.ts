import { Command } from "commander";
import { apiGet } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printList } from "../utils/output.js";

/**
 * Audit log reader. `audit.all` filters by action/target/search server-side but
 * has no time window, so `--since` is applied client-side over the fetched
 * page — raise `--limit` when you widen the window.
 */

interface AuditRow {
	auditId?: string;
	action: string;
	targetType: string | null;
	targetName: string | null;
	actorEmail?: string | null;
	createdAt: string;
}

/** Accepts an ISO timestamp or a relative `30m` / `24h` / `7d` window. */
export function parseSince(value: string, now = new Date()): Date {
	const relative = /^(\d+)([mhd])$/.exec(value.trim());
	if (relative) {
		const amount = Number(relative[1]);
		const unit = relative[2];
		const ms = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
		return new Date(now.getTime() - amount * ms);
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw usageError(`--since expects an ISO date or a window like 30m, 24h, 7d (got "${value}")`);
	}
	return parsed;
}

export function filterSince(rows: AuditRow[], since: Date | null): AuditRow[] {
	if (!since) return rows;
	return rows.filter((row) => new Date(row.createdAt).getTime() >= since.getTime());
}

export function auditCommand(): Command {
	const audit = new Command("audit").description("Read the organization audit log");

	addOutputOptions(
		audit
			.command("list")
			.description("List audit events (newest first)")
			.option("--since <when>", "ISO date or relative window: 30m, 24h, 7d")
			.option("--action <action>", "Exact action, e.g. application.deploy")
			.option("--target-type <type>", "Target type, e.g. application")
			.option("--search <text>", "Free-text search over target names")
			.option("--limit <n>", "Rows to fetch (default 50)")
			.option("--offset <n>", "Rows to skip"),
	).action(
		async (options: {
			since?: string;
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
			const page = await apiGet<{ events?: AuditRow[]; rows?: AuditRow[] } | AuditRow[]>(
				"audit.all",
				{
					action: options.action,
					targetType: options.targetType,
					search: options.search,
					limit,
					offset,
				},
			);
			const rows = Array.isArray(page) ? page : ((page.events ?? page.rows ?? []) as AuditRow[]);
			const since = options.since ? parseSince(options.since) : null;
			printList(filterSince(rows, since), [
				"createdAt",
				"action",
				"targetType",
				"targetName",
				"actorEmail",
			]);
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
