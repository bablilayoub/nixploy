import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	deployments,
	incidents,
	rollbacks,
	serviceEvents,
} from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { performApplicationRollback } from "../application/rollback";
import {
	findComposeSnapshot,
	listComposeRollbackTargets,
	restoreComposeSnapshot,
} from "../compose/snapshot";
import { publishPlatformEventDetached } from "../deployment/notify";
import { badRequest, notFound, preconditionFailed } from "../errors";
import { notifyEvent } from "../notifications";
import { findIncident, recordIncident, resolveIncident } from "../observability";
import { isServiceKind } from "../services/kinds";
import { SERVICE_REGISTRY } from "../services/registry";
import {
	buildProposal,
	buildRolloutProposal,
	type FailureSignal,
	isRemediationProposal,
	isRolloutStep,
	passesGuards,
	pickPreviousPin,
	REMEDIATION_FAILURE_THRESHOLD,
	REMEDIATION_WINDOW_MS,
	type RemediationProposal,
	ROLLOUT_STEPS,
	ROLLOUT_WINDOW_MS,
	type RollbackCandidate,
	type RolloutSignal,
	shouldPropose,
} from "./rules";

export {
	REMEDIATION_COOLDOWN_MS,
	REMEDIATION_FAILURE_THRESHOLD,
	REMEDIATION_WINDOW_MS,
	type RemediationAction,
	type RemediationProposal,
} from "./rules";

const log = createLogger("remediation");

/** Incident kind the proposals are filed under. */
export const REMEDIATION_INCIDENT_KIND = "remediation";

/** Kill switch: `NIXPLOY_REMEDIATION=0` stops the rule pass; open proposals stay. */
export const remediationEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
	env.NIXPLOY_REMEDIATION !== "0";

const FAILURE_KINDS = ["task_failed", "oom_killed"] as const;

/** Services whose timeline crossed the threshold inside the window. */
async function findFailureSignals(now: Date): Promise<FailureSignal[]> {
	const since = new Date(now.getTime() - REMEDIATION_WINDOW_MS);
	const rows = await db
		.select({
			serviceType: serviceEvents.serviceType,
			serviceId: serviceEvents.serviceId,
			organizationId: serviceEvents.organizationId,
			appName: sql<string>`max(${serviceEvents.appName})`,
			failures: sql<number>`count(*)::int`,
			oomKills: sql<number>`count(*) filter (where ${serviceEvents.kind} = 'oom_killed')::int`,
			latestAt: sql<string | Date>`max(${serviceEvents.occurredAt})`,
		})
		.from(serviceEvents)
		.where(
			and(gte(serviceEvents.occurredAt, since), inArray(serviceEvents.kind, [...FAILURE_KINDS])),
		)
		.groupBy(serviceEvents.serviceType, serviceEvents.serviceId, serviceEvents.organizationId)
		.having(sql`count(*) >= ${REMEDIATION_FAILURE_THRESHOLD}`);
	return rows.map((row) => ({
		serviceType: row.serviceType,
		serviceId: row.serviceId,
		organizationId: row.organizationId,
		appName: row.appName,
		failures: Number(row.failures),
		oomKills: Number(row.oomKills),
		latestAt: new Date(row.latestAt),
	}));
}

/**
 * Deploys that died after the image reached the cluster, newest per service.
 * A build failure never appears here: `current_step` is still `build`, the
 * running service never changed, and there is nothing to roll back.
 */
async function findRolloutSignals(now: Date): Promise<RolloutSignal[]> {
	const since = new Date(now.getTime() - ROLLOUT_WINDOW_MS);
	const rows = await db.query.deployments.findMany({
		where: and(
			eq(deployments.status, "error"),
			eq(deployments.isPreview, false),
			gte(deployments.finishedAt, since),
			inArray(deployments.currentStep, [...ROLLOUT_STEPS]),
		),
		columns: {
			deploymentId: true,
			applicationId: true,
			composeId: true,
			appName: true,
			currentStep: true,
			errorMessage: true,
			finishedAt: true,
		},
		orderBy: desc(deployments.finishedAt),
	});
	const seen = new Set<string>();
	const signals: RolloutSignal[] = [];
	for (const row of rows) {
		const serviceId = row.applicationId ?? row.composeId;
		if (!serviceId || seen.has(serviceId) || !isRolloutStep(row.currentStep)) continue;
		const serviceType = row.applicationId ? "application" : "compose";
		const tenancy = await SERVICE_REGISTRY[serviceType].module.findTenancy(serviceId);
		if (!tenancy) continue;
		seen.add(serviceId);
		signals.push({
			serviceType,
			serviceId,
			appName: row.appName ?? tenancy.appName,
			organizationId: tenancy.organizationId,
			deploymentId: row.deploymentId,
			step: row.currentStep,
			errorMessage: row.errorMessage,
			finishedAt: row.finishedAt ?? now,
		});
	}
	return signals;
}

/** Per service: is a proposal open, and when was the newest one made. */
async function proposalHistory(
	serviceIds: string[],
): Promise<Map<string, { open: boolean; lastAt: Date | null }>> {
	const history = new Map<string, { open: boolean; lastAt: Date | null }>();
	if (serviceIds.length === 0) return history;
	const rows = await db
		.select({
			serviceId: incidents.serviceId,
			createdAt: incidents.createdAt,
			resolvedAt: incidents.resolvedAt,
		})
		.from(incidents)
		.where(
			and(eq(incidents.kind, REMEDIATION_INCIDENT_KIND), inArray(incidents.serviceId, serviceIds)),
		)
		.orderBy(desc(incidents.createdAt));
	for (const row of rows) {
		if (!row.serviceId) continue;
		const entry = history.get(row.serviceId) ?? { open: false, lastAt: null };
		entry.open = entry.open || row.resolvedAt === null;
		entry.lastAt = entry.lastAt ?? row.createdAt;
		history.set(row.serviceId, entry);
	}
	return history;
}

/** Services with a deployment queued or running — the reconciler skips them too. */
async function deployingServices(serviceIds: string[]): Promise<Set<string>> {
	if (serviceIds.length === 0) return new Set();
	const rows = await db
		.select({ applicationId: deployments.applicationId, composeId: deployments.composeId })
		.from(deployments)
		.where(
			and(
				inArray(deployments.status, ["queued", "running"]),
				or(
					inArray(deployments.applicationId, serviceIds),
					inArray(deployments.composeId, serviceIds),
				),
			),
		);
	const busy = new Set<string>();
	for (const row of rows) {
		if (row.applicationId) busy.add(row.applicationId);
		if (row.composeId) busy.add(row.composeId);
	}
	return busy;
}

/** The last known good pin before the one running now, if there is one. */
async function rollbackCandidate(signal: {
	serviceType: string;
	serviceId: string;
}): Promise<RollbackCandidate | null> {
	if (signal.serviceType === "application") {
		const pins = await db.query.rollbacks.findMany({
			where: eq(rollbacks.applicationId, signal.serviceId),
			orderBy: desc(rollbacks.createdAt),
			limit: 2,
		});
		const previous = pickPreviousPin(pins);
		return previous
			? {
					kind: "application",
					rollbackId: previous.rollbackId,
					image: previous.image,
					deploymentId: previous.deploymentId,
				}
			: null;
	}
	if (signal.serviceType === "compose") {
		const targets = await listComposeRollbackTargets(signal.serviceId);
		const previous = pickPreviousPin(targets);
		return previous
			? {
					kind: "compose",
					snapshotId: previous.snapshotId,
					sourceDeploymentId: previous.deploymentId,
				}
			: null;
	}
	// Databases have no image pin to go back to; the proposal explains itself.
	return null;
}

export interface ProposeRemediationsResult {
	candidates: number;
	proposed: number;
}

/** A rollout failure is the louder signal, so it wins when both fire. */
function rulesFor(
	failureSignals: FailureSignal[],
	rolloutSignals: RolloutSignal[],
): Array<{ serviceId: string; restart?: FailureSignal; rollout?: RolloutSignal }> {
	const byService = new Map<
		string,
		{ serviceId: string; restart?: FailureSignal; rollout?: RolloutSignal }
	>();
	for (const signal of rolloutSignals) {
		byService.set(signal.serviceId, { serviceId: signal.serviceId, rollout: signal });
	}
	for (const signal of failureSignals) {
		const entry = byService.get(signal.serviceId);
		if (entry) entry.restart = signal;
		else byService.set(signal.serviceId, { serviceId: signal.serviceId, restart: signal });
	}
	return [...byService.values()];
}

/**
 * The rule pass. Runs after every reconciler pass (the pass that just wrote
 * the task failures it reads), one grouped query over the last window, then
 * one incident per service that crossed the line and is not already covered
 * by an open proposal, a recent one, or a deployment in flight. Never
 * throws: a failure here must not fail the reconciler.
 */
export async function proposeRemediations(now = new Date()): Promise<ProposeRemediationsResult> {
	if (!remediationEnabled()) return { candidates: 0, proposed: 0 };
	const [failureSignals, rolloutSignals] = await Promise.all([
		findFailureSignals(now),
		findRolloutSignals(now),
	]);
	const candidates = rulesFor(failureSignals, rolloutSignals);
	if (candidates.length === 0) return { candidates: 0, proposed: 0 };
	const serviceIds = candidates.map((entry) => entry.serviceId);
	const [history, deploying] = await Promise.all([
		proposalHistory(serviceIds),
		deployingServices(serviceIds),
	]);

	let proposed = 0;
	for (const entry of candidates) {
		const past = history.get(entry.serviceId) ?? { open: false, lastAt: null };
		const context = {
			now,
			openProposal: past.open,
			lastProposalAt: past.lastAt,
			deploying: deploying.has(entry.serviceId),
		};
		const signal = entry.rollout ?? entry.restart;
		if (!signal) continue;
		const allowed = entry.rollout
			? passesGuards(context)
			: entry.restart
				? shouldPropose(entry.restart, context)
				: false;
		if (!allowed) continue;
		try {
			if (entry.rollout) await proposeForRollout(entry.rollout);
			else if (entry.restart) await proposeFor(entry.restart);
			proposed += 1;
		} catch (error) {
			log.warn("Could not file a remediation proposal", {
				service: signal.appName,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { candidates: candidates.length, proposed };
}

async function proposeForRollout(signal: RolloutSignal): Promise<void> {
	if (!isServiceKind(signal.serviceType)) return;
	const tenancy = await SERVICE_REGISTRY[signal.serviceType].module.findTenancy(signal.serviceId);
	if (!tenancy || tenancy.organizationId !== signal.organizationId) return;
	const proposal = buildRolloutProposal(signal, await rollbackCandidate(signal));
	await fileProposal(signal.serviceType, signal.serviceId, signal.appName, tenancy, proposal);
}

async function proposeFor(signal: FailureSignal): Promise<void> {
	if (!isServiceKind(signal.serviceType)) return;
	const tenancy = await SERVICE_REGISTRY[signal.serviceType].module.findTenancy(signal.serviceId);
	// The row is gone (deleted since the events were written) or the event
	// row disagrees with the service's org — either way, nothing to propose.
	if (!tenancy || tenancy.organizationId !== signal.organizationId) return;
	const proposal = buildProposal(signal, await rollbackCandidate(signal));
	await fileProposal(signal.serviceType, signal.serviceId, signal.appName, tenancy, proposal);
}

/** The incident, the log line, the live frame and the notification. */
async function fileProposal(
	serviceType: string,
	serviceId: string,
	appName: string,
	tenancy: { organizationId: string; projectId: string; name: string },
	proposal: RemediationProposal,
): Promise<void> {
	const signal = { serviceType, serviceId, appName };
	const incident = await recordIncident({
		organizationId: tenancy.organizationId,
		projectId: tenancy.projectId,
		kind: REMEDIATION_INCIDENT_KIND,
		severity: proposal.severity,
		title: proposal.title,
		message: proposal.reason,
		serviceId: signal.serviceId,
		serviceName: tenancy.name,
		metadata: { serviceKind: signal.serviceType, proposal },
	});
	log.info("Remediation proposed", {
		service: signal.appName,
		action: proposal.action.type,
		incidentId: incident.incidentId,
	});
	publishPlatformEventDetached({
		kind: "incident",
		organizationId: tenancy.organizationId,
		incidentId: incident.incidentId,
		incidentKind: REMEDIATION_INCIDENT_KIND,
	});
	await notifyEvent(tenancy.organizationId, "serviceAlert", {
		title: proposal.title,
		message: `${proposal.reason}${
			proposal.action.type === "none"
				? ""
				: " Open Monitoring → Incidents to apply or dismiss the proposed rollback."
		}`,
		fields: [
			{ name: "Service", value: tenancy.name },
			{
				name: "Why",
				value:
					proposal.rule === "rollout_failed"
						? "The last deploy failed after the image reached the cluster"
						: `${proposal.failures} task failures in ${proposal.windowMinutes} min`,
			},
			{ name: "Proposed", value: proposal.action.type.replace(/_/g, " ") },
		],
	}).catch((error) => {
		log.debug("Remediation notification failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

/** The open proposal an incident carries, or the reason it cannot be acted on. */
async function openProposal(incidentId: string, organizationId: string) {
	const incident = await findIncident(incidentId, organizationId);
	if (incident.kind !== REMEDIATION_INCIDENT_KIND) {
		throw badRequest("This incident is not a remediation proposal");
	}
	if (incident.resolvedAt)
		throw preconditionFailed("This proposal was already applied or dismissed");
	const proposal = incident.metadata?.proposal;
	if (!isRemediationProposal(proposal)) throw badRequest("This proposal has no readable action");
	return { incident, proposal: proposal as RemediationProposal };
}

export interface ApplyRemediationResult {
	incidentId: string;
	action: RemediationProposal["action"]["type"];
	deploymentId: string;
}

/**
 * A human said yes: perform the proposed rollback through the same code the
 * manual rollback uses, then close the proposal with what was done. The
 * caller has checked `service.deploy` (and `secrets.write` for compose).
 */
export async function applyRemediation(input: {
	incidentId: string;
	organizationId: string;
	userId: string;
}): Promise<ApplyRemediationResult> {
	const { incident, proposal } = await openProposal(input.incidentId, input.organizationId);
	if (proposal.action.type === "none") {
		throw preconditionFailed(
			"This proposal has no action to apply — it only explains what to check",
		);
	}
	if (!incident.serviceId) throw preconditionFailed("The proposal's service is gone");

	let deploymentId: string;
	if (proposal.action.type === "rollback_application") {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, incident.serviceId),
			columns: { applicationId: true, appName: true, serverId: true },
		});
		if (!application) throw notFound("Application not found");
		const tenancy = await SERVICE_REGISTRY.application.module.findTenancy(
			application.applicationId,
		);
		if (tenancy?.organizationId !== input.organizationId) throw notFound("Application not found");
		const result = await performApplicationRollback({
			application,
			rollbackId: proposal.action.rollbackId,
			triggeredBy: input.userId,
		});
		deploymentId = result.deployment.deploymentId;
	} else {
		const row = await db.query.compose.findFirst({
			where: eq(compose.composeId, incident.serviceId),
			columns: { composeId: true, sourceType: true },
		});
		if (!row) throw notFound("Compose service not found");
		const tenancy = await SERVICE_REGISTRY.compose.module.findTenancy(row.composeId);
		if (tenancy?.organizationId !== input.organizationId)
			throw notFound("Compose service not found");
		const snapshot = await findComposeSnapshot(row.composeId, proposal.action.snapshotId);
		if (!snapshot) throw notFound("Rollback snapshot not found");
		await restoreComposeSnapshot(row, snapshot);
		// Lazy: `deployment/index.ts` registers the job runner and pulls the
		// worker in; the reconciler (which loads this module) must not.
		const { queueDeployment } = await import("../deployment");
		deploymentId = await queueDeployment({
			composeId: row.composeId,
			type: "redeploy",
			title: "Rollback",
			trigger: "rollback",
			triggeredBy: input.userId,
			commitMessage: `Rollback to deployment ${snapshot.deploymentId}`,
		});
	}

	await db
		.update(incidents)
		.set({
			metadata: {
				...(incident.metadata ?? {}),
				proposal: {
					...proposal,
					appliedAt: new Date().toISOString(),
					appliedBy: input.userId,
					deploymentId,
				},
			},
		})
		.where(eq(incidents.incidentId, incident.incidentId));
	await resolveIncident({
		incidentId: incident.incidentId,
		organizationId: input.organizationId,
		userId: input.userId,
		note: `Applied: ${
			proposal.action.type === "rollback_application"
				? `rolled back to ${proposal.action.image}`
				: `restored deployment ${proposal.action.sourceDeploymentId}`
		} (deployment ${deploymentId})`,
	});
	return { incidentId: incident.incidentId, action: proposal.action.type, deploymentId };
}

/** A human said no: close the proposal, leave the service alone until the next window. */
export async function dismissRemediation(input: {
	incidentId: string;
	organizationId: string;
	userId: string;
}): Promise<{ incidentId: string }> {
	const { incident } = await openProposal(input.incidentId, input.organizationId);
	await db
		.update(incidents)
		.set({
			metadata: {
				...(incident.metadata ?? {}),
				proposal: {
					...(incident.metadata?.proposal as Record<string, unknown>),
					dismissedAt: new Date().toISOString(),
					dismissedBy: input.userId,
				},
			},
		})
		.where(eq(incidents.incidentId, incident.incidentId));
	await resolveIncident({
		incidentId: incident.incidentId,
		organizationId: input.organizationId,
		userId: input.userId,
		note: "Dismissed",
	});
	return { incidentId: incident.incidentId };
}
