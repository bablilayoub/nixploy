import { describe, expect, it } from "vitest";
import {
	encodePreviewSourceRef,
	isMetadataOnlyPullRequestUpdate,
	parsePreviewSourceRef,
	previewSourceRefForPullRequest,
	pullRequestHeadRef,
} from "./source-ref";

describe("preview source refs", () => {
	it("round-trips every ref kind through the branch column", () => {
		for (const ref of [
			{ kind: "branch" as const, branch: "feature/x" },
			{ kind: "ref" as const, ref: "refs/pull/12/head" },
			{ kind: "fork" as const, owner: "someone", repository: "app", branch: "fix/it" },
			{ kind: "fork" as const, owner: "group/sub", repository: "app", branch: "a:b" },
		]) {
			expect(parsePreviewSourceRef(encodePreviewSourceRef(ref))).toEqual(ref);
		}
	});

	it("treats plain values as branches and rejects malformed fork specs", () => {
		expect(parsePreviewSourceRef("main")).toEqual({ kind: "branch", branch: "main" });
		expect(parsePreviewSourceRef(null)).toBeNull();
		expect(parsePreviewSourceRef("fork:nobranch")).toBeNull();
		expect(parsePreviewSourceRef("fork:noslash:branch")).toBeNull();
	});

	it("knows each provider's PR head ref", () => {
		expect(pullRequestHeadRef("github", "42")).toBe("refs/pull/42/head");
		expect(pullRequestHeadRef("gitea", "42")).toBe("refs/pull/42/head");
		expect(pullRequestHeadRef("gitlab", "42")).toBe("refs/merge-requests/42/head");
		expect(pullRequestHeadRef("bitbucket", "42")).toBeNull();
		expect(pullRequestHeadRef("github", "not-a-number")).toBeNull();
	});

	it("keeps the plain branch for same-repo PRs", () => {
		expect(
			previewSourceRefForPullRequest({
				provider: "github",
				number: "7",
				branch: "feat",
				isFork: false,
			}),
		).toBe("feat");
	});

	it("uses the PR head ref for fork PRs and the fork repo on Bitbucket", () => {
		expect(
			previewSourceRefForPullRequest({
				provider: "github",
				number: "7",
				branch: "feat",
				isFork: true,
				headRepoFullName: "forker/app",
			}),
		).toBe("refs/pull/7/head");
		expect(
			previewSourceRefForPullRequest({
				provider: "gitlab",
				number: "7",
				branch: "feat",
				isFork: true,
			}),
		).toBe("refs/merge-requests/7/head");
		expect(
			previewSourceRefForPullRequest({
				provider: "bitbucket",
				number: "7",
				branch: "feat",
				isFork: true,
				headRepoFullName: "forker/app",
			}),
		).toBe("fork:forker/app:feat");
		// Bitbucket fork with no head repository: nothing to fetch.
		expect(
			previewSourceRefForPullRequest({
				provider: "bitbucket",
				number: "7",
				branch: "feat",
				isFork: true,
			}),
		).toBeNull();
	});
});

describe("isMetadataOnlyPullRequestUpdate", () => {
	it("ignores an `updated` delivery whose head commit is already checked out", () => {
		expect(
			isMetadataOnlyPullRequestUpdate({
				action: "updated",
				headCommit: "abcdef0123456789",
				deployedCommit: "abcdef0123456789",
			}),
		).toBe(true);
		// Bitbucket sends short hashes in some payloads.
		expect(
			isMetadataOnlyPullRequestUpdate({
				action: "updated",
				headCommit: "abcdef012345",
				deployedCommit: "ABCDEF0123456789",
			}),
		).toBe(true);
	});

	it("rebuilds when the commit changed, is unknown, or the action is not an update", () => {
		expect(
			isMetadataOnlyPullRequestUpdate({
				action: "updated",
				headCommit: "1111111111",
				deployedCommit: "2222222222",
			}),
		).toBe(false);
		expect(
			isMetadataOnlyPullRequestUpdate({
				action: "updated",
				headCommit: "1111111111",
				deployedCommit: null,
			}),
		).toBe(false);
		expect(
			isMetadataOnlyPullRequestUpdate({
				action: "created",
				headCommit: "1111111111",
				deployedCommit: "1111111111",
			}),
		).toBe(false);
	});
});
