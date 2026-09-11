import { count, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	deployments,
	environments,
	projects,
	uptimeProbes,
} from "../../db/schema";
import { queueDepth } from "../deployment/queue";
import { SERVICE_DEFS } from "../services/registry";
import { readLatestMetricsSample } from "./store";

/**
 * OpenMetrics / Prometheus text exposition of one organization's fleet
 * (`GET /api/metrics`, authenticated with an API key).
 *
 * Two halves on purpose:
 * - {@link renderPrometheus} is **pure** — a snapshot in, the exposition
 *   text out — so escaping and formatting are unit-tested without a database
 *   or a Docker socket;
 * - {@link collectPrometheusSnapshot} fills that snapshot from the existing
 *   metrics store (the same in-memory ring `fleetOverview` reads, so
 *   scraping costs no Docker calls), the deployment table and the in-process
 *   deploy queue.
 *
 * Scraping is intentionally cheap and stale-tolerant: the sampler writes
 * every 30 s, so a 15 s scrape interval simply sees the same point twice.
 * There is no per-replica breakdown here — Prometheus users who want that
 * run cAdvisor; this endpoint answers "what does Nixploy know about my
 * services", which is what alerting rules need.
 */

/** One service line of the exposition. */
export interface ServiceMetric {
	appName: string;
	kind: string;
	project: string;
	environment: string;
	/** Latest sampled CPU percent, or null when the service has no history. */
	cpuPercent: number | null;
	memoryBytes: number | null;
	memoryLimitBytes: number | null;
	/** Service row status mapped to 1 (running) / 0 (anything else). */
	up: boolean;
}

export interface PrometheusSnapshot {
	services: ServiceMetric[];
	/** Deployment row counts keyed by status (`queued`, `running`, `done`, …). */
	deploymentsByStatus: Record<string, number>;
	/** Uptime probes by host+path, 1 when the last check said `up`. */
	probes: Array<{ probe: string; up: boolean }>;
	/** In-process deploy queue of this panel (pending + running, all lines). */
	queue: { pending: number; running: number };
}

/* -------------------------------------------------------------------------- */
/*  Rendering (pure)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Escape a label value per the exposition format: backslash, double quote
 * and newline. Everything else — including UTF-8 — passes through, so a
 * project called `Café "prod"` renders correctly instead of being mangled.
 */
export function escapeLabelValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** `{a="1",b="2"}`, or the empty string when every label is empty. */
function renderLabels(labels: Record<string, string | undefined>): string {
	const parts = Object.entries(labels)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string")
		.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`);
	return parts.length > 0 ? `{${parts.join(",")}}` : "";
}

/** Prometheus wants `1`, `0.5`, `NaN`, `+Inf` — never `1e+21` surprises. */
function renderValue(value: number): string {
	if (Number.isNaN(value)) return "NaN";
	if (value === Number.POSITIVE_INFINITY) return "+Inf";
	if (value === Number.NEGATIVE_INFINITY) return "-Inf";
	// Round to 4 decimals: CPU percentages carry 12 meaningless digits otherwise.
	return String(Math.round(value * 10_000) / 10_000);
}

interface Family {
	name: string;
	help: string;
	type: "gauge" | "counter";
	samples: Array<{ labels: Record<string, string | undefined>; value: number }>;
}

function renderFamily(family: Family): string[] {
	const lines = [`# HELP ${family.name} ${family.help}`, `# TYPE ${family.name} ${family.type}`];
	for (const sample of family.samples) {
		lines.push(`${family.name}${renderLabels(sample.labels)} ${renderValue(sample.value)}`);
	}
	return lines;
}

/**
 * Render a snapshot as Prometheus text exposition (version 0.0.4, which
 * OpenMetrics scrapers also accept). A family with no samples still prints
 * its HELP/TYPE header so a scraper sees the metric exists and an alert on
 * `absent()` does not fire the moment an org has no services.
 */
export function renderPrometheus(snapshot: PrometheusSnapshot): string {
	const serviceLabels = (service: ServiceMetric) => ({
		service: service.appName,
		kind: service.kind,
		project: service.project,
		environment: service.environment,
	});

	const families: Family[] = [
		{
			name: "nixploy_service_cpu_percent",
			help: "Latest sampled CPU usage of a service, in percent of one core.",
			type: "gauge",
			samples: snapshot.services
				.filter((service) => service.cpuPercent !== null)
				.map((service) => ({
					labels: serviceLabels(service),
					value: service.cpuPercent ?? 0,
				})),
		},
		{
			name: "nixploy_service_memory_bytes",
			help: "Latest sampled resident memory of a service, in bytes.",
			type: "gauge",
			samples: snapshot.services
				.filter((service) => service.memoryBytes !== null)
				.map((service) => ({
					labels: serviceLabels(service),
					value: service.memoryBytes ?? 0,
				})),
		},
		{
			name: "nixploy_service_memory_limit_bytes",
			help: "Memory limit the last sample saw for a service, in bytes (0 when unlimited).",
			type: "gauge",
			samples: snapshot.services
				.filter((service) => service.memoryLimitBytes !== null)
				.map((service) => ({
					labels: serviceLabels(service),
					value: service.memoryLimitBytes ?? 0,
				})),
		},
		{
			name: "nixploy_service_status",
			help: "1 when Nixploy considers the service running, 0 otherwise.",
			type: "gauge",
			samples: snapshot.services.map((service) => ({
				labels: serviceLabels(service),
				value: service.up ? 1 : 0,
			})),
		},
		{
			name: "nixploy_deployments_total",
			help: "Deployment rows of this organization by status.",
			type: "counter",
			samples: Object.entries(snapshot.deploymentsByStatus)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([status, value]) => ({ labels: { status }, value })),
		},
		{
			name: "nixploy_uptime_probe_up",
			help: "1 when the last uptime probe check succeeded, 0 when it failed (unknown probes are omitted).",
			type: "gauge",
			samples: snapshot.probes.map((probe) => ({
				labels: { probe: probe.probe },
				value: probe.up ? 1 : 0,
			})),
		},
		{
			name: "nixploy_queue_depth",
			help: "Deploy jobs on this panel process, by state.",
			type: "gauge",
			samples: [
				{ labels: { state: "pending" }, value: snapshot.queue.pending },
				{ labels: { state: "running" }, value: snapshot.queue.running },
			],
		},
	];

	// Exposition must end with a newline or scrapers reject the last sample.
	return `${families.flatMap(renderFamily).join("\n")}\n`;
}

/* -------------------------------------------------------------------------- */
/*  Collection                                                                */
/* -------------------------------------------------------------------------- */

/** Service row statuses that count as "up" for `nixploy_service_status`. */
const RUNNING_STATUSES = new Set(["running", "done"]);

/**
 * Snapshot one organization's fleet. Reads are the same ones the Monitoring
 * page makes (`readLatestMetricsSample` is answered from the in-memory ring
 * when the sampler is warm), plus two aggregate queries — a scrape never
 * touches Docker or SSH.
 */
export async function collectPrometheusSnapshot(
	organizationId: string,
): Promise<PrometheusSnapshot> {
	const orgProjects = await db.query.projects.findMany({
		where: eq(projects.organizationId, organizationId),
		columns: { projectId: true, name: true },
	});
	const projectNameById = new Map(orgProjects.map((row) => [row.projectId, row.name]));
	const projectIds = orgProjects.map((row) => row.projectId);

	const environmentRows =
		projectIds.length > 0
			? await db.query.environments.findMany({
					where: inArray(environments.projectId, projectIds),
					columns: { environmentId: true, name: true, projectId: true },
				})
			: [];
	const envById = new Map(environmentRows.map((row) => [row.environmentId, row]));
	const envIds = environmentRows.map((row) => row.environmentId);

	const summaries =
		envIds.length > 0
			? (await Promise.all(SERVICE_DEFS.map((def) => def.module.listSummaries(envIds)))).flat()
			: [];

	const services: ServiceMetric[] = await Promise.all(
		summaries.map(async (row) => {
			const environment = envById.get(row.environmentId);
			const sample = await readLatestMetricsSample(row.appName);
			return {
				appName: row.appName,
				kind: row.kind,
				project: projectNameById.get(environment?.projectId ?? "") ?? "unknown",
				environment: environment?.name ?? "unknown",
				cpuPercent: sample ? sample.cpu : null,
				memoryBytes: sample ? sample.memoryUsed : null,
				memoryLimitBytes: sample ? sample.memoryTotal : null,
				up: RUNNING_STATUSES.has(row.status ?? ""),
			};
		}),
	);

	const [deploymentsByStatus, probes] = await Promise.all([
		countDeploymentsByStatus(envIds),
		listProbeStates(organizationId),
	]);

	// The queue is process-local by design (multi-replica is unsupported), so
	// this is "this panel's backlog", not a cluster-wide figure.
	const queue = queueDepth(null);

	return { services, deploymentsByStatus, probes, queue };
}

/** `(status, count)` over every deployment of the org's environments. */
async function countDeploymentsByStatus(envIds: string[]): Promise<Record<string, number>> {
	// Always emit every status so a rule on `nixploy_deployments_total{status="error"}`
	// has a series before the first failure.
	const totals: Record<string, number> = {
		queued: 0,
		running: 0,
		done: 0,
		error: 0,
		cancelled: 0,
	};
	if (envIds.length === 0) return totals;

	// Two inner joins rather than one left join: a deployment row belongs to
	// exactly one of the two service tables, and rows written by schedule runs
	// (`modules/schedules#recordRun`) belong to neither and must not be counted.
	const [applicationRows, composeRows] = await Promise.all([
		db
			.select({ status: deployments.status, value: count() })
			.from(deployments)
			.innerJoin(applications, eq(deployments.applicationId, applications.applicationId))
			.where(inArray(applications.environmentId, envIds))
			.groupBy(deployments.status),
		db
			.select({ status: deployments.status, value: count() })
			.from(deployments)
			.innerJoin(compose, eq(deployments.composeId, compose.composeId))
			.where(inArray(compose.environmentId, envIds))
			.groupBy(deployments.status),
	]);
	for (const row of [...applicationRows, ...composeRows]) {
		totals[row.status] = (totals[row.status] ?? 0) + row.value;
	}

	return totals;
}

/** Uptime probes of the org, labelled by the host they check. */
async function listProbeStates(
	organizationId: string,
): Promise<Array<{ probe: string; up: boolean }>> {
	const rows = await db.query.uptimeProbes.findMany({
		where: eq(uptimeProbes.organizationId, organizationId),
		columns: { enabled: true, path: true, status: true },
		with: { domain: { columns: { host: true } } },
	});
	return (
		rows
			// `unknown` means "never checked" — emitting 0 would look like an
			// outage on every fresh probe.
			.filter((row) => row.enabled && row.status !== "unknown")
			.map((row) => ({
				probe: `${row.domain?.host ?? "unknown"}${row.path}`,
				up: row.status === "up",
			}))
	);
}

/** Content type Prometheus expects for text exposition. */
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
