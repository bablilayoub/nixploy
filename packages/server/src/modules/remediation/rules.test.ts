import { describe, expect, it } from "vitest";
import {
	buildProposal,
	type FailureSignal,
	isRemediationProposal,
	pickPreviousPin,
	REMEDIATION_COOLDOWN_MS,
	REMEDIATION_FAILURE_THRESHOLD,
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
