/**
 * The deterministic half of "propose and approve": which failure pattern
 * earns a proposal, what the proposal says, and when to stay quiet. Pure —
 * no database, no clock of its own — so every threshold is unit-tested.
 */

/** Failures counted over this window. */
export const REMEDIATION_WINDOW_MS = 10 * 60 * 1000;
/** Task failures (or OOM kills) inside the window before a proposal is made. */
export const REMEDIATION_FAILURE_THRESHOLD = 3;
/** After a proposal (applied, dismissed or still open) the service is left alone this long. */
export const REMEDIATION_COOLDOWN_MS = 60 * 60 * 1000;

export interface FailureSignal {
	serviceType: string;
	serviceId: string;
	appName: string;
	organizationId: string;
	/** `task_failed` + `oom_killed` rows in the window. */
	failures: number;
	/** How many of those were the OOM killer. */
	oomKills: number;
	latestAt: Date;
}

export type RemediationAction =
	| {
			type: "rollback_application";
			rollbackId: string;
			image: string;
			/** The deployment that produced the pinned image (null when pruned). */
			deploymentId: string | null;
	  }
	| {
			type: "rollback_compose";
			snapshotId: string;
			/** The deployment the snapshot was captured for. */
			sourceDeploymentId: string;
	  }
	/** Nothing safe to do automatically; the message says what to look at. */
	| { type: "none" };

export interface RemediationProposal {
	rule: "restart_loop";
	action: RemediationAction;
	/** One sentence, shown as the incident message. */
	reason: string;
	title: string;
	severity: "warning" | "error";
	failures: number;
	oomKills: number;
	windowMinutes: number;
}

/** What the rule needs to know about the service's history. */
export interface ProposalContext {
	now: Date;
	/** An unresolved `remediation` incident already exists for the service. */
	openProposal: boolean;
	/** When the newest remediation incident for the service was created. */
	lastProposalAt: Date | null;
	/** A deployment is queued or running for the service right now. */
	deploying: boolean;
}

/** Threshold, one-at-a-time, cooldown and "not while it is being deployed". */
export function shouldPropose(signal: FailureSignal, context: ProposalContext): boolean {
	if (signal.failures < REMEDIATION_FAILURE_THRESHOLD) return false;
	if (context.openProposal || context.deploying) return false;
	if (
		context.lastProposalAt &&
		context.now.getTime() - context.lastProposalAt.getTime() < REMEDIATION_COOLDOWN_MS
	) {
		return false;
	}
	return true;
}

/** A rollback target the proposal can offer, or null when there is none. */
export type RollbackCandidate =
	| { kind: "application"; rollbackId: string; image: string; deploymentId: string | null }
	| { kind: "compose"; snapshotId: string; sourceDeploymentId: string };

/**
 * The newest pin is what the crashing service runs now; the one before it
 * is the last known good. One pin means nothing to go back to.
 */
export function pickPreviousPin<T>(pinsNewestFirst: readonly T[]): T | null {
	return pinsNewestFirst[1] ?? null;
}

const windowMinutes = Math.round(REMEDIATION_WINDOW_MS / 60_000);

export function buildProposal(
	signal: FailureSignal,
	candidate: RollbackCandidate | null,
): RemediationProposal {
	const oom = signal.oomKills > 0 && signal.oomKills * 2 >= signal.failures;
	const what = oom
		? `killed by the out-of-memory killer ${signal.oomKills} times`
		: `failed ${signal.failures} times`;
	const base = {
		rule: "restart_loop" as const,
		failures: signal.failures,
		oomKills: signal.oomKills,
		windowMinutes,
	};

	if (oom) {
		// A rollback rarely fixes memory pressure; the honest proposal is the
		// limit, and that is a setting, not a button.
		return {
			...base,
			action: { type: "none" },
			severity: "error",
			title: `${signal.appName} keeps running out of memory`,
			reason: `${signal.appName} was ${what} in the last ${windowMinutes} minutes. Raise its memory limit (Advanced → Resources) or the org quota, then redeploy; rolling back does not usually help here.`,
		};
	}
	if (candidate?.kind === "application") {
		return {
			...base,
			action: {
				type: "rollback_application",
				rollbackId: candidate.rollbackId,
				image: candidate.image,
				deploymentId: candidate.deploymentId,
			},
			severity: "warning",
			title: `${signal.appName} is in a restart loop — roll back?`,
			reason: `${signal.appName} ${what} in the last ${windowMinutes} minutes. The previous pinned image (${candidate.image}) ran before this deploy; applying rolls the Swarm service back to it in seconds.`,
		};
	}
	if (candidate?.kind === "compose") {
		return {
			...base,
			action: {
				type: "rollback_compose",
				snapshotId: candidate.snapshotId,
				sourceDeploymentId: candidate.sourceDeploymentId,
			},
			severity: "warning",
			title: `${signal.appName} is in a restart loop — roll back?`,
			reason: `${signal.appName} ${what} in the last ${windowMinutes} minutes. Applying restores the compose file and env from deployment ${candidate.sourceDeploymentId} and redeploys the stack.`,
		};
	}
	return {
		...base,
		action: { type: "none" },
		severity: "warning",
		title: `${signal.appName} is in a restart loop`,
		reason: `${signal.appName} ${what} in the last ${windowMinutes} minutes and has no earlier deployment to roll back to. Check its runtime log (Runtime → History) and the task errors on the timeline.`,
	};
}

/** Runtime guard for the proposal stored in `incident.metadata`. */
export function isRemediationProposal(value: unknown): value is RemediationProposal {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	const action = candidate.action as Record<string, unknown> | undefined;
	return (
		candidate.rule === "restart_loop" &&
		typeof candidate.reason === "string" &&
		typeof candidate.title === "string" &&
		!!action &&
		typeof action.type === "string" &&
		["rollback_application", "rollback_compose", "none"].includes(action.type)
	);
}
