import { describe, expect, it } from "vitest";
import {
	buildProposal,
	buildRolloutProposal,
	type FailureSignal,
	isRemediationProposal,
	isRolloutStep,
	passesGuards,
	pickPreviousPin,
	REMEDIATION_COOLDOWN_MS,
	REMEDIATION_FAILURE_THRESHOLD,
	type RolloutSignal,
	shouldPropose,
} from "./rules";

const now = new Date("2026-09-20T10:00:00Z");
const signal = (overrides: Partial<FailureSignal> = {}): FailureSignal => ({
	serviceType: "application",
	serviceId: "app_1",
	appName: "shop",
	organizationId: "org_1",
	failures: REMEDIATION_FAILURE_THRESHOLD,
	oomKills: 0,
	latestAt: now,
	...overrides,
});
const quiet = { now, openProposal: false, lastProposalAt: null, deploying: false };

describe("shouldPropose", () => {
	it("needs the threshold, no open proposal, no deploy in flight and a cold service", () => {
		expect(shouldPropose(signal(), quiet)).toBe(true);
		expect(shouldPropose(signal({ failures: REMEDIATION_FAILURE_THRESHOLD - 1 }), quiet)).toBe(
			false,
		);
		expect(shouldPropose(signal(), { ...quiet, openProposal: true })).toBe(false);
		expect(shouldPropose(signal(), { ...quiet, deploying: true })).toBe(false);
		expect(
			shouldPropose(signal(), {
				...quiet,
				lastProposalAt: new Date(now.getTime() - REMEDIATION_COOLDOWN_MS + 1000),
			}),
		).toBe(false);
		expect(
			shouldPropose(signal(), {
				...quiet,
				lastProposalAt: new Date(now.getTime() - REMEDIATION_COOLDOWN_MS - 1000),
			}),
		).toBe(true);
	});
});

describe("pickPreviousPin", () => {
	it("offers the pin before the current one, and nothing with a single pin", () => {
		expect(pickPreviousPin(["current", "previous", "older"])).toBe("previous");
		expect(pickPreviousPin(["only"])).toBeNull();
		expect(pickPreviousPin([])).toBeNull();
	});
});

describe("buildProposal", () => {
	it("proposes an application rollback to the previous image", () => {
		const proposal = buildProposal(signal({ failures: 4 }), {
			kind: "application",
			rollbackId: "rb_2",
			image: "shop:abc123",
			deploymentId: "dep_2",
		});
		expect(proposal.action).toEqual({
			type: "rollback_application",
			rollbackId: "rb_2",
			image: "shop:abc123",
			deploymentId: "dep_2",
		});
		expect(proposal.title).toContain("roll back?");
		expect(proposal.reason).toContain("failed 4 times");
		expect(proposal.severity).toBe("warning");
		expect(isRemediationProposal(proposal)).toBe(true);
	});
	it("proposes a compose rollback to the earlier snapshot", () => {
		const proposal = buildProposal(signal({ serviceType: "compose" }), {
			kind: "compose",
			snapshotId: "snap_1",
			sourceDeploymentId: "dep_1",
		});
		expect(proposal.action).toEqual({
			type: "rollback_compose",
			snapshotId: "snap_1",
			sourceDeploymentId: "dep_1",
		});
		expect(proposal.reason).toContain("dep_1");
	});
	it("never proposes a rollback for memory pressure, and says what to change instead", () => {
		const proposal = buildProposal(signal({ failures: 3, oomKills: 3 }), {
			kind: "application",
			rollbackId: "rb_2",
			image: "shop:abc123",
			deploymentId: null,
		});
		expect(proposal.action).toEqual({ type: "none" });
		expect(proposal.severity).toBe("error");
		expect(proposal.reason).toMatch(/memory limit/);
	});
	it("explains itself when there is nothing to roll back to", () => {
		const proposal = buildProposal(signal(), null);
		expect(proposal.action).toEqual({ type: "none" });
		expect(proposal.reason).toMatch(/no earlier deployment/);
	});
});

const rollout = (overrides: Partial<RolloutSignal> = {}): RolloutSignal => ({
	serviceType: "application",
	serviceId: "app_1",
	appName: "shop",
	organizationId: "org_1",
	deploymentId: "dep_abcdef123456",
	step: "converge",
	errorMessage: "Service shop did not converge within 180s",
	finishedAt: now,
	...overrides,
});

describe("buildRolloutProposal", () => {
	it("offers the image that ran before the failed deploy", () => {
		const proposal = buildRolloutProposal(rollout(), {
			kind: "application",
			rollbackId: "rb_2",
			image: "shop:good",
			deploymentId: "dep_good",
		});
		expect(proposal.rule).toBe("rollout_failed");
		expect(proposal.action).toMatchObject({ type: "rollback_application", image: "shop:good" });
		expect(proposal.title).toContain("did not roll out");
		expect(proposal.reason).toContain("converge step");
		expect(proposal.reason).toContain("did not converge within 180s");
		expect(isRemediationProposal(proposal)).toBe(true);
	});
	it("names each rollout step in words and truncates a long engine error", () => {
		for (const step of ["rollout", "converge", "post_deploy"] as const) {
			const proposal = buildRolloutProposal(rollout({ step, errorMessage: "x".repeat(400) }), null);
			expect(proposal.reason).toContain(step.replace(/_/g, "-"));
			expect(proposal.reason.length).toBeLessThan(500);
		}
	});
	it("explains itself with no earlier deployment, and restores a compose snapshot", () => {
		expect(buildRolloutProposal(rollout(), null).action).toEqual({ type: "none" });
		expect(
			buildRolloutProposal(rollout({ serviceType: "compose" }), {
				kind: "compose",
				snapshotId: "snap_1",
				sourceDeploymentId: "dep_1",
			}).action,
		).toMatchObject({ type: "rollback_compose", snapshotId: "snap_1" });
	});
});

describe("isRolloutStep", () => {
	it("accepts only the steps that leave a service on a new version", () => {
		for (const step of ["rollout", "converge", "post_deploy"]) {
			expect(isRolloutStep(step)).toBe(true);
		}
		for (const step of ["source", "build", "push", "route", "finalize", null, 3]) {
			expect(isRolloutStep(step)).toBe(false);
		}
	});
});

describe("passesGuards", () => {
	it("is the shared half of shouldPropose, without the failure threshold", () => {
		expect(passesGuards(quiet)).toBe(true);
		expect(passesGuards({ ...quiet, openProposal: true })).toBe(false);
		expect(passesGuards({ ...quiet, deploying: true })).toBe(false);
		// A single failure passes the guards but not the restart-loop threshold.
		expect(shouldPropose(signal({ failures: 1 }), quiet)).toBe(false);
	});
});

describe("isRemediationProposal", () => {
	it("rejects shapes that are not a proposal", () => {
		expect(isRemediationProposal(null)).toBe(false);
		expect(isRemediationProposal({ rule: "restart_loop" })).toBe(false);
		expect(
			isRemediationProposal({
				rule: "restart_loop",
				reason: "r",
				title: "t",
				action: { type: "x" },
			}),
		).toBe(false);
	});
});
