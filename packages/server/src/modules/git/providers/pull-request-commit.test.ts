import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Head-commit metadata extracted from real-shaped pull-request payloads, one
 * recorded fixture per provider (trimmed to the fields the parsers read).
 *
 * The point of the fixtures is the *asymmetry*: GitLab is the only provider
 * that ships the head commit's message, author and URL on a merge-request
 * event; GitHub, Gitea and Bitbucket send the sha alone, so only a link can
 * be reconstructed. A regression that silently drops GitLab's `last_commit`
 * — or starts inventing messages for the others — fails here.
 */

const verifyMock = vi.fn().mockResolvedValue(true);
vi.mock("@octokit/webhooks", () => ({
	Webhooks: class {
		verify = verifyMock;
	},
}));

const rows: Record<string, unknown[]> = {};
vi.mock("../../../db", () => ({
	db: {
		select: () => ({ from: (table: { __name: string }) => makeQuery(table) }),
	},
}));

function makeQuery(table: { __name: string }) {
	const result = rows[table.__name] ?? [];
	return Object.assign(Promise.resolve(result), {
		where: () => Promise.resolve(result),
	});
}

vi.mock("../../../db/schema", () => ({
	github: { __name: "github", githubId: "github_id" },
	gitlab: { __name: "gitlab", gitlabId: "gitlab_id" },
	gitea: { __name: "gitea", giteaId: "gitea_id" },
	bitbucket: { __name: "bitbucket", bitbucketId: "bitbucket_id" },
}));

vi.mock("../webhook-secret", () => ({
	derivedWebhookSecret: () => "test-secret",
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

import { createHmac } from "node:crypto";
import { verifyAndExtractBitbucket } from "./bitbucket";
import { verifyAndExtractGitea } from "./gitea";
import { verifyAndExtractGithub } from "./github";
import { verifyAndExtractGitlab } from "./gitlab";

const SHA = "9f2a1c4e7b3d8a0516243f5c6789ab0cdef12345";

beforeEach(() => {
	rows.github = [{ githubId: "gh1", githubWebhookSecret: "s" }];
	rows.gitlab = [{ gitlabId: "gl1", secret: "s" }];
	rows.gitea = [{ giteaId: "gt1" }];
	rows.bitbucket = [{ bitbucketId: "bb1" }];
});

describe("github pull_request head commit", () => {
	const payload = {
		action: "synchronize",
		repository: { full_name: "acme/panel", html_url: "https://github.com/acme/panel" },
		pull_request: {
			number: 42,
			id: 5551,
			title: "Add the metrics endpoint",
			html_url: "https://github.com/acme/panel/pull/42",
			user: { login: "octocat" },
			head: {
				ref: "feat/metrics",
				sha: SHA,
				repo: { full_name: "acme/panel", fork: false, html_url: "https://github.com/acme/panel" },
			},
		},
	};

	it("links the head sha and reports no message/author (GitHub sends neither)", async () => {
		const result = await verifyAndExtractGithub(
			{ "x-github-event": "pull_request", "x-hub-signature-256": "sha256=x" },
			JSON.stringify(payload),
		);
		expect(result.pullRequest).toMatchObject({
			number: "42",
			headCommit: SHA,
			headCommitMessage: null,
			headCommitAuthor: null,
			headCommitUrl: `https://github.com/acme/panel/commit/${SHA}`,
			authorLogin: "octocat",
		});
	});

	it("points at the fork repository for a fork PR", async () => {
		const forked = structuredClone(payload);
		forked.pull_request.head.repo = {
			full_name: "contributor/panel",
			fork: true,
			html_url: "https://github.com/contributor/panel",
		};
		const result = await verifyAndExtractGithub(
			{ "x-github-event": "pull_request", "x-hub-signature-256": "sha256=x" },
			JSON.stringify(forked),
		);
		expect(result.pullRequest?.headCommitUrl).toBe(
			`https://github.com/contributor/panel/commit/${SHA}`,
		);
		expect(result.pullRequest?.isFork).toBe(true);
	});
});

describe("gitlab merge_request head commit", () => {
	const payload = {
		object_kind: "merge_request",
		project: { path_with_namespace: "group/sub/app" },
		user: { username: "ayoub" },
		object_attributes: {
			iid: 7,
			id: 900,
			action: "update",
			oldrev: "1111111111111111111111111111111111111111",
			source_branch: "feat/prometheus",
			title: "Export Prometheus metrics",
			url: "https://git.internal.example/group/sub/app/-/merge_requests/7",
			source_project_id: 3,
			target_project_id: 3,
			last_commit: {
				id: SHA,
				message: "feat(metrics): OpenMetrics exposition\n\nLong body nobody wants in a table cell.",
				url: `https://git.internal.example/group/sub/app/-/commit/${SHA}`,
				author: { name: "Ayoub Bablil", email: "ayoub@example.test" },
			},
		},
	};

	it("keeps message, author and the self-hosted URL from last_commit", async () => {
		const result = await verifyAndExtractGitlab({ "x-gitlab-token": "s" }, JSON.stringify(payload));
		expect(result.pullRequest).toMatchObject({
			number: "7",
			headCommit: SHA,
			headCommitMessage: "feat(metrics): OpenMetrics exposition",
			headCommitAuthor: "Ayoub Bablil",
			headCommitUrl: `https://git.internal.example/group/sub/app/-/commit/${SHA}`,
		});
	});

	it("caps an overlong subject at 200 characters", async () => {
		const long = structuredClone(payload);
		long.object_attributes.last_commit.message = "x".repeat(400);
		const result = await verifyAndExtractGitlab({ "x-gitlab-token": "s" }, JSON.stringify(long));
		expect(result.pullRequest?.headCommitMessage).toHaveLength(200);
		expect(result.pullRequest?.headCommitMessage?.endsWith("…")).toBe(true);
	});
});

describe("gitea pull_request head commit", () => {
	const payload = {
		action: "opened",
		repository: { full_name: "ops/infra", html_url: "https://git.example.org/ops/infra" },
		pull_request: {
			number: 12,
			id: 88,
			title: "Bump traefik",
			html_url: "https://git.example.org/ops/infra/pulls/12",
			user: { login: "maintainer" },
			head: {
				ref: "bump/traefik",
				sha: SHA,
				repo: {
					full_name: "ops/infra",
					fork: false,
					html_url: "https://git.example.org/ops/infra",
				},
			},
		},
	};

	it("builds the commit URL from the self-hosted instance in the payload", async () => {
		const body = JSON.stringify(payload);
		const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
		const result = await verifyAndExtractGitea(
			{ "x-gitea-event": "pull_request", "x-gitea-signature": signature },
			body,
			"gt1",
		);
		expect(result.pullRequest).toMatchObject({
			number: "12",
			headCommit: SHA,
			headCommitMessage: null,
			headCommitAuthor: null,
			headCommitUrl: `https://git.example.org/ops/infra/commit/${SHA}`,
		});
	});
});

describe("bitbucket pullrequest head commit", () => {
	const base = {
		repository: { full_name: "space/repo", name: "repo", workspace: { slug: "space" } },
		pullrequest: {
			id: 3,
			title: "Tidy the compose file",
			links: { html: { href: "https://bitbucket.org/space/repo/pull-requests/3" } },
			author: { nickname: "dev" },
			source: {
				branch: { name: "tidy" },
				repository: {
					full_name: "space/repo",
					links: { html: { href: "https://bitbucket.org/space/repo" } },
				},
				commit: { hash: SHA },
			},
		},
	};

	it("derives the /commits/ URL from the source repository", async () => {
		const result = await verifyAndExtractBitbucket(
			{ "x-event-key": "pullrequest:updated", authorization: "Bearer test-secret" },
			JSON.stringify(base),
			"bb1",
		);
		expect(result.pullRequest).toMatchObject({
			number: "3",
			headCommit: SHA,
			headCommitMessage: null,
			headCommitAuthor: null,
			headCommitUrl: `https://bitbucket.org/space/repo/commits/${SHA}`,
		});
	});

	it("prefers an explicit html link on the commit when the plan sends one", async () => {
		const withLink = structuredClone(base);
		(withLink.pullrequest.source.commit as Record<string, unknown>).links = {
			html: { href: "https://bitbucket.org/space/repo/commits/short" },
		};
		const result = await verifyAndExtractBitbucket(
			{ "x-event-key": "pullrequest:updated", authorization: "Bearer test-secret" },
			JSON.stringify(withLink),
			"bb1",
		);
		expect(result.pullRequest?.headCommitUrl).toBe(
			"https://bitbucket.org/space/repo/commits/short",
		);
	});
});
