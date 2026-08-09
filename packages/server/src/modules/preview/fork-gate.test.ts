import { describe, expect, it } from "vitest";
import { decideForkPreviewGate, isForkPullRequest } from "./fork-gate";

describe("decideForkPreviewGate", () => {
	it("allows non-fork PRs regardless of the setting", () => {
		expect(
			decideForkPreviewGate({ isFork: false, requireApproval: true, isCollaborator: null }),
		).toBe("allow");
		expect(
			decideForkPreviewGate({ isFork: false, requireApproval: false, isCollaborator: false }),
		).toBe("allow");
	});

	it("allows fork PRs when the app opted out of the gate", () => {
		expect(
			decideForkPreviewGate({ isFork: true, requireApproval: false, isCollaborator: false }),
		).toBe("allow");
		expect(
			decideForkPreviewGate({ isFork: true, requireApproval: false, isCollaborator: null }),
		).toBe("allow");
	});

	it("allows fork PRs from repo collaborators", () => {
		expect(
			decideForkPreviewGate({ isFork: true, requireApproval: true, isCollaborator: true }),
		).toBe("allow");
	});

	it("gates fork PRs from non-collaborators", () => {
		expect(
			decideForkPreviewGate({ isFork: true, requireApproval: true, isCollaborator: false }),
		).toBe("awaiting_approval");
	});

	it("fails safe when the collaborator check could not run", () => {
		expect(
			decideForkPreviewGate({ isFork: true, requireApproval: true, isCollaborator: null }),
		).toBe("awaiting_approval");
	});
});

describe("isForkPullRequest", () => {
	it("compares head/base repo full names case-insensitively", () => {
		expect(
			isForkPullRequest({ headRepoFullName: "fork-owner/app", baseRepoFullName: "Org/app" }),
		).toBe(true);
		expect(isForkPullRequest({ headRepoFullName: "Org/app", baseRepoFullName: "org/app" })).toBe(
			false,
		);
	});

	it("falls back to the provider fork flag when names are missing", () => {
		expect(isForkPullRequest({ headRepoForkFlag: true })).toBe(true);
		expect(isForkPullRequest({ headRepoForkFlag: false })).toBe(false);
		expect(isForkPullRequest({})).toBe(false);
	});
});
