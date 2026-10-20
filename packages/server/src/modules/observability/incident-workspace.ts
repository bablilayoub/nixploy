import { and, count, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { deployments, domains, environments, incidents, projects } from "../../db/schema";
import { badRequest, notFound } from "../errors";
import { assertProjectVisible, isProjectVisible, projectIdFilter } from "../projects/project-scope";
import { isServiceKind } from "../services/kinds";

export type IncidentState = "open" | "resolved" | "all";

/** An interrupted admission must remain inspectable without replaying it. */
export function recoveryStartIsActive(operation: {
	state?: unknown;
	startedAt?: unknown;
}): boolean {
	if (operation.state !== "applying" || typeof operation.startedAt !== "string") return false;
	const age = Date.now() - Date.parse(operation.startedAt);
	return Number.isFinite(age) && age >= 0 && age < 5 * 60_000;
}

function incidentConditions(organizationId: string, projectId?: string) {
	const conditions = [eq(incidents.organizationId, organizationId)];
	if (projectId) conditions.push(eq(incidents.projectId, projectId));
	const scoped = projectIdFilter(incidents.projectId);
	if (scoped) {
		const visible = or(isNull(incidents.projectId), scoped);
		if (visible) conditions.push(visible);
	}
	return conditions;
}

export async function findIncident(incidentId: string, organizationId: string) {
	const row = await db.query.incidents.findFirst({
		where: and(eq(incidents.incidentId, incidentId), eq(incidents.organizationId, organizationId)),
	});
	if (!row) throw notFound("Incident not found");
	if (row.projectId) assertProjectVisible(row.projectId, "Incident");
	return row;
}

export async function listIncidentPage(
	organizationId: string,
	input: {
		projectId?: string;
		state?: IncidentState;
		cursor?: string | null;
		limit?: number;
	},
) {
	const conditions = incidentConditions(organizationId, input.projectId);
	const openConditions = [...conditions, isNull(incidents.resolvedAt)];
	if (input.state === "open") conditions.push(isNull(incidents.resolvedAt));
	if (input.state === "resolved") conditions.push(isNotNull(incidents.resolvedAt));
	if (input.cursor) {
		try {
			if (input.cursor.length > 500) throw new Error("Malformed pagination cursor");
			const parsed: unknown = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
			if (
				!Array.isArray(parsed) ||
				parsed.length !== 2 ||
				typeof parsed[0] !== "string" ||
				typeof parsed[1] !== "string" ||
				!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(
					parsed[0],
				) ||
				!Number.isFinite(Date.parse(parsed[0])) ||
				parsed[1].length > 200
			)
				throw new Error("Malformed pagination cursor");
			const instant = parsed[0];
			const older = or(
				sql`${incidents.createdAt} < ${instant}::timestamptz`,
				and(
					sql`${incidents.createdAt} = ${instant}::timestamptz`,
					sql`${incidents.incidentId} < ${parsed[1]}`,
				),
			);
			if (older) conditions.push(older);
		} catch {
			throw badRequest("Invalid incident cursor. Refresh the list and try again.");
		}
	}
	const limit = input.limit ?? 30;
	const [rows, totals] = await Promise.all([
		db.query.incidents.findMany({
			extras: { cursorTime: sql<string>`${incidents.createdAt}::text`.as("cursor_time") },
			where: and(...conditions),
			orderBy: [desc(incidents.createdAt), desc(incidents.incidentId)],
			limit: limit + 1,
		}),
		db
			.select({ count: count() })
			.from(incidents)
			.where(and(...openConditions)),
	]);
	const page = rows.slice(0, limit);
	const last = page.at(-1);
	return {
		incidents: page.map(({ cursorTime: _cursorTime, ...row }) => row),
		nextCursor:
			rows.length > limit && last
				? Buffer.from(JSON.stringify([last.cursorTime, last.incidentId])).toString("base64url")
				: null,
		openCount: Number(totals[0]?.count ?? 0),
	};
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export async function getIncidentWorkspace(incidentId: string, organizationId: string) {
	const incident = await findIncident(incidentId, organizationId);
	const proposal = record(incident.metadata?.proposal);
	const operation = record(proposal.operation);
	const kind = incident.metadata?.serviceKind;
	const { SERVICE_REGISTRY } = await import("../services/registry");
	const tenancy =
		incident.serviceId && isServiceKind(kind)
			? await SERVICE_REGISTRY[kind].module.findTenancy(incident.serviceId)
			: undefined;
	const visible =
		tenancy?.organizationId === organizationId && isProjectVisible(tenancy.projectId)
			? tenancy
			: null;
	const [project, environment] = visible
		? await Promise.all([
				db.query.projects.findFirst({
					where: eq(projects.projectId, visible.projectId),
					columns: { name: true },
				}),
				db.query.environments.findFirst({
					where: eq(environments.environmentId, visible.environmentId),
					columns: { name: true },
				}),
			])
		: [null, null];
	const service =
		visible && isServiceKind(kind)
			? {
					kind,
					serviceId: visible.serviceId,
					name: visible.name,
					appName: visible.appName,
					projectId: visible.projectId,
					projectName: project?.name ?? "Project",
					environmentName: environment?.name ?? "Environment",
					serverId: visible.serverId,
				}
			: null;
	const deploymentCondition =
		service?.kind === "application"
			? eq(deployments.applicationId, service.serviceId)
			: service?.kind === "compose"
				? eq(deployments.composeId, service.serviceId)
				: null;
	const readDeployment = async (id: unknown) => {
		if (typeof id !== "string" || !deploymentCondition) return null;
		return (
			(await db.query.deployments.findFirst({
				where: and(eq(deployments.deploymentId, id), deploymentCondition),
				columns: {
					deploymentId: true,
					title: true,
					status: true,
					errorMessage: true,
					currentStep: true,
					createdAt: true,
					finishedAt: true,
				},
			})) ?? null
		);
	};
	const [sourceDeployment, recoveryDeployment, domainRows] = await Promise.all([
		readDeployment(incident.metadata?.deploymentId),
		readDeployment(operation.deploymentId ?? proposal.deploymentId),
		service?.kind === "application" || service?.kind === "compose"
			? db.query.domains.findMany({
					where:
						service.kind === "application"
							? eq(domains.applicationId, service.serviceId)
							: eq(domains.composeId, service.serviceId),
					columns: { domainId: true, host: true, path: true, https: true },
				})
			: Promise.resolve([]),
	]);
	const hasOperation = Object.keys(operation).length > 0 || typeof proposal.appliedAt === "string";
	const status = recoveryDeployment?.status;
	const recoveryState: "applying" | "queued" | "running" | "completed" | "failed" | "unknown" =
		status === "done"
			? "completed"
			: status === "error" || status === "cancelled"
				? "failed"
				: status === "queued" || status === "running"
					? status
					: operation.state === "failed"
						? "failed"
						: recoveryStartIsActive(operation)
							? "applying"
							: "unknown";
	return {
		incident,
		service,
		domains: domainRows,
		sourceDeployment,
		recovery: hasOperation
			? {
					state: recoveryState,
					deploymentId: recoveryDeployment?.deploymentId ?? null,
					error:
						recoveryDeployment?.errorMessage ??
						(typeof operation.error === "string" ? operation.error : null),
					startedAt:
						typeof operation.startedAt === "string"
							? operation.startedAt
							: typeof proposal.appliedAt === "string"
								? proposal.appliedAt
								: null,
				}
			: null,
	};
}
