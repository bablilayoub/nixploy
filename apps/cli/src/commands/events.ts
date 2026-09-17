import { Command } from "commander";
import { apiGet } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printList } from "../utils/output.js";
import { parseSince } from "./audit.js";

/**
 * Service event timeline reader — "why did it restart?" from a terminal.
 *
 * The audit log answers what a *human* did; this answers what happened to a
 * service: tasks that died, out-of-memory kills, deploys, drift the reconciler
 * corrected. Both read-only, both paginated server-side.
 */

const SERVICE_KINDS = [
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
] as const;

interface ServiceEventRow {
	serviceEventId: string;
	kind: string;
	severity: string;
	title: string;
	message: string | null;
	actorEmail: string | null;
	occurredAt: string;
}

interface ServiceEventPage {
	events: ServiceEventRow[];
	nextCursor: string | null;
}

export function eventsCommand(): Command {
	const events = new Command("events").description("Read a service's event timeline");

	addOutputOptions(
		events
			.command("list")
			.description("List a service's events (newest first)")
			.argument("<serviceId>", "Application, compose or database id")
			.option("--type <kind>", `Service kind: ${SERVICE_KINDS.join(" | ")} (default application)`)
			.option(
				"--kind <kinds>",
				"Comma-separated event kinds, e.g. oom_killed,task_failed,deploy_failed",
			)
			.option("--since <when>", "ISO date or relative window: 30m, 24h, 7d")
			.option("--limit <n>", "Rows to fetch (default 50, max 200)")
			.option("--cursor <cursor>", "Continue from a previous page's nextCursor"),
	).action(
		async (
			serviceId: string,
			options: {
				type?: string;
				kind?: string;
				since?: string;
				limit?: string;
				cursor?: string;
			},
		) => {
			const serviceType = options.type ?? "application";
			if (!(SERVICE_KINDS as readonly string[]).includes(serviceType)) {
				throw usageError(`--type expects one of: ${SERVICE_KINDS.join(", ")}`);
			}
			const limit = options.limit ? Number(options.limit) : undefined;
			if (limit !== undefined && !Number.isFinite(limit)) {
				throw usageError("--limit expects a number");
			}
			// Normalised to ISO here so the panel filters on an instant, not on a
			// relative window resolved against its own clock.
			const since = options.since ? parseSince(options.since).toISOString() : undefined;
			const page = await apiGet<ServiceEventPage>("observability.serviceEvents", {
				serviceType,
				serviceId,
				kinds: options.kind,
				since,
				limit,
				cursor: options.cursor,
			});
			printList(page.events ?? [], [
				"occurredAt",
				"kind",
				"severity",
				"title",
				"actorEmail",
				"message",
			]);
		},
	);

	return events;
}
