import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../deployment", () => ({ queueDeployment: vi.fn() }));
vi.mock("../application/paths", () => ({
	getWildcardDomain: () => "nip.io",
}));
vi.mock("../application/docker", () => ({
	removeSwarmService: vi.fn(),
	removeApplicationImages: vi.fn(),
}));
vi.mock("../traefik", () => ({
	writeAppTraefikConfig: vi.fn(),
	removeTraefikConfig: vi.fn(),
	DEFAULT_CONTAINER_PORT: 80,
}));

import { createHmac } from "node:crypto";
import { db } from "../../db";
import { classifyPullRequestAction, previewAppName, previewHost } from "../preview";
import {
	applicationMatchesPreviewWebhook,
	extractPushCommit,
	globCacheSize,
	handleGitWebhook,
	isGitlabMetadataOnlyUpdate,
	type PreviewWebhookCandidate,
	serviceMatchesWebhook,
	WebhookIgnored,
	type WebhookRepoContext,
	type WebhookServiceCandidate,
	WebhookUnauthorized,
	watchPathsMatch,
	webhookProvenance,
} from "./webhook-handler";

describe("extractPushCommit", () => {
	it("reads GitHub/Gitea head_commit shapes", () => {
		expect(
			extractPushCommit(
				"0123456789abcdef0123456789abcdef01234567",
				{ id: "ignored", message: "feat: x\n\nbody", author: { name: "Jane", email: "j@x" } },
				"pusher",
			),
		).toEqual({
			sha: "0123456789abcdef0123456789abcdef01234567",
			message: "feat: x\n\nbody",
			author: "Jane",
		});
	});

	it("reads Bitbucket raw authors and falls back to the actor", () => {
		expect(
			extractPushCommit(undefined, {
				hash: "abcdef1234",
				message: "m",
				author: { raw: "Jo <j@x>" },
			}),
		).toEqual({ sha: "abcdef1234", message: "m", author: "Jo" });
		expect(extractPushCommit("abcdef1234", { author: { user: { display_name: "Disp" } } })).toEqual(
			{ sha: "abcdef1234", message: null, author: "Disp" },
		);
		expect(extractPushCommit("abcdef1234", {}, "Actor")).toEqual({
			sha: "abcdef1234",
			message: null,
			author: "Actor",
		});
	});

	it("yields nothing for branch deletions and garbage", () => {
		expect(extractPushCommit("0000000000000000000000000000000000000000", {})).toBeUndefined();
		expect(extractPushCommit("not-a-sha", { id: "also not" })).toBeUndefined();
		expect(extractPushCommit(undefined, undefined)).toBeUndefined();
	});
});

describe("webhookProvenance", () => {
	it("attributes the deployment to the provider webhook with the head commit", () => {
		expect(
			webhookProvenance({
				provider: "gitlab",
				commit: { sha: "abcdef1", message: "m", author: "a" },
			}),
		).toEqual({
			trigger: "webhook",
			triggeredBy: "webhook:gitlab",
			commitSha: "abcdef1",
			commitMessage: "m",
			commitAuthor: "a",
		});
		expect(webhookProvenance({ provider: "github" })).toEqual({
			trigger: "webhook",
			triggeredBy: "webhook:github",
			commitSha: null,
			commitMessage: null,
			commitAuthor: null,
		});
	});
});

describe("watchPathsMatch", () => {
	it("deploys everything when no watch paths are configured", () => {
		expect(watchPathsMatch(["README.md"], null)).toBe(true);
		expect(watchPathsMatch(["README.md"], [])).toBe(true);
		expect(watchPathsMatch(["src/index.ts"], ["", "  "])).toBe(true);
	});

	it("deploys when the provider sent no file list (filter cannot be evaluated)", () => {
		expect(watchPathsMatch(undefined, ["src"])).toBe(true);
	});

	it("matches exact paths and directory prefixes", () => {
		expect(watchPathsMatch(["src/index.ts"], ["src"])).toBe(true);
		expect(watchPathsMatch(["package.json"], ["package.json"])).toBe(true);
		expect(watchPathsMatch(["src2/index.ts"], ["src"])).toBe(false);
		expect(watchPathsMatch(["docs/guide.md"], ["src", "app"])).toBe(false);
	});

	it("matches globs: ** crosses directories, * stays within one segment", () => {
		expect(watchPathsMatch(["src/deep/nested/file.ts"], ["src/**"])).toBe(true);
		expect(watchPathsMatch(["src/file.ts"], ["src/*.ts"])).toBe(true);
		expect(watchPathsMatch(["src/deep/file.ts"], ["src/*.ts"])).toBe(false);
	});

	it("normalizes leading and trailing slashes in patterns", () => {
		expect(watchPathsMatch(["src/index.ts"], ["/src/"])).toBe(true);
	});

	it("compiles each glob once and reuses it across paths and deliveries", () => {
		const before = globCacheSize();
		const paths = Array.from({ length: 40 }, (_, i) => `docs/page-${i}.md`);
		expect(watchPathsMatch(paths, ["src/**/*.ts", "lib/*.js"])).toBe(false);
		expect(watchPathsMatch(paths, ["src/**/*.ts", "lib/*.js"])).toBe(false);
		expect(globCacheSize()).toBe(before + 2);
	});

	it("never compiles a pattern that violates the watch-path caps (legacy rows)", () => {
		const hostile = `${"**a".repeat(40)}`;
		const before = globCacheSize();
		const started = Date.now();
		// Exact / prefix matching still applies; the glob branch is skipped.
		expect(watchPathsMatch([`${"a".repeat(2000)}b`], [hostile])).toBe(false);
		expect(watchPathsMatch([hostile, `${hostile}/x`], [hostile])).toBe(true);
		expect(Date.now() - started).toBeLessThan(500);
		expect(globCacheSize()).toBe(before);
	});
});

describe("serviceMatchesWebhook", () => {
	const baseApp: WebhookServiceCandidate = {
		sourceType: "github",
		repository: "nixploy",
		owner: "NixployHQ",
		branch: "main",
		autoDeploy: true,
		watchPaths: null,
	};
	const baseWebhook: WebhookRepoContext = {
		provider: "github",
		repository: "nixploy",
		owner: "nixployhq",
		branch: "main",
	};

	it("matches same repo+branch with case-insensitive owner", () => {
		expect(serviceMatchesWebhook(baseApp, baseWebhook)).toBe(true);
	});

	it("rejects a different branch, repository, provider or auto-deploy off", () => {
		expect(serviceMatchesWebhook(baseApp, { ...baseWebhook, branch: "develop" })).toBe(false);
		expect(serviceMatchesWebhook(baseApp, { ...baseWebhook, repository: "other" })).toBe(false);
		expect(serviceMatchesWebhook({ ...baseApp, sourceType: "gitlab" }, baseWebhook)).toBe(false);
		expect(serviceMatchesWebhook({ ...baseApp, autoDeploy: false }, baseWebhook)).toBe(false);
	});

	it("rejects when the owner differs or the app has no repository", () => {
		expect(serviceMatchesWebhook(baseApp, { ...baseWebhook, owner: "someone-else" })).toBe(false);
		expect(serviceMatchesWebhook({ ...baseApp, repository: null }, baseWebhook)).toBe(false);
	});

	it("applies watch paths against the delivery's changed files", () => {
		const watched = { ...baseApp, watchPaths: ["src"] };
		expect(serviceMatchesWebhook(watched, { ...baseWebhook, changedPaths: ["src/a.ts"] })).toBe(
			true,
		);
		expect(serviceMatchesWebhook(watched, { ...baseWebhook, changedPaths: ["docs/b.md"] })).toBe(
			false,
		);
		// No file list in the delivery (e.g. Bitbucket) → deploy.
		expect(serviceMatchesWebhook(watched, baseWebhook)).toBe(true);
	});

	// A git-backed compose stack carries the identical columns, so the same
	// predicate decides both. A `raw` stack has no repository and must never
	// match, whatever the delivery says.
	it("matches a git-backed compose stack and never a raw one", () => {
		const gitCompose: WebhookServiceCandidate = {
			sourceType: "github",
			repository: "nixploy",
			owner: "NixployHQ",
			branch: "main",
			autoDeploy: true,
			watchPaths: null,
		};
		expect(serviceMatchesWebhook(gitCompose, baseWebhook)).toBe(true);

		const rawCompose: WebhookServiceCandidate = {
			sourceType: "raw",
			repository: null,
			owner: null,
			branch: null,
			autoDeploy: true,
			watchPaths: null,
		};
		expect(serviceMatchesWebhook(rawCompose, baseWebhook)).toBe(false);
	});
});

describe("applicationMatchesPreviewWebhook", () => {
	const baseApp: PreviewWebhookCandidate = {
		sourceType: "github",
		repository: "nixploy",
		owner: "NixployHQ",
		isPreviewDeploymentsActive: true,
	};
	const baseWebhook = {
		provider: "github" as const,
		repository: "nixploy",
		owner: "nixployhq",
	};

	it("matches same repo with previews enabled, ignoring branch", () => {
		expect(applicationMatchesPreviewWebhook(baseApp, baseWebhook)).toBe(true);
	});

	it("rejects when previews are off, repo differs, or provider differs", () => {
		expect(
			applicationMatchesPreviewWebhook(
				{ ...baseApp, isPreviewDeploymentsActive: false },
				baseWebhook,
			),
		).toBe(false);
		expect(applicationMatchesPreviewWebhook(baseApp, { ...baseWebhook, repository: "other" })).toBe(
			false,
		);
		expect(
			applicationMatchesPreviewWebhook({ ...baseApp, sourceType: "gitlab" }, baseWebhook),
		).toBe(false);
	});

	it("rejects when the owner differs or the app has no repository", () => {
		expect(
			applicationMatchesPreviewWebhook(baseApp, { ...baseWebhook, owner: "someone-else" }),
		).toBe(false);
		expect(applicationMatchesPreviewWebhook({ ...baseApp, repository: null }, baseWebhook)).toBe(
			false,
		);
	});
});

describe("classifyPullRequestAction", () => {
	it("classifies open/sync/reopen as upsert", () => {
		for (const action of [
			"opened",
			"open",
			"synchronize",
			"reopened",
			"update",
			"updated",
			"created",
		]) {
			expect(classifyPullRequestAction(action)).toBe("upsert");
		}
	});

	it("classifies close/merge/fulfilled/rejected as delete", () => {
		for (const action of ["closed", "close", "merge", "merged", "fulfilled", "rejected"]) {
			expect(classifyPullRequestAction(action)).toBe("delete");
		}
	});

	it("ignores unrelated actions", () => {
		expect(classifyPullRequestAction("labeled")).toBe("ignore");
		expect(classifyPullRequestAction("assigned")).toBe("ignore");
	});
});

describe("isGitlabMetadataOnlyUpdate", () => {
	it("flags `update` events without oldrev and nothing else", () => {
		expect(isGitlabMetadataOnlyUpdate("update", undefined)).toBe(true);
		expect(isGitlabMetadataOnlyUpdate("update", "")).toBe(true);
		expect(isGitlabMetadataOnlyUpdate("update", "abc123")).toBe(false);
		expect(isGitlabMetadataOnlyUpdate("open", undefined)).toBe(false);
		expect(isGitlabMetadataOnlyUpdate("reopen", undefined)).toBe(false);
	});
});

describe("preview naming helpers", () => {
	it("builds variant app names and hosts", () => {
		expect(previewAppName("myapp-aa11bb", "42")).toBe("myapp-aa11bb-pr-42");
		expect(previewHost("myapp-aa11bb", "42")).toBe("pr-42-myapp-aa11bb.nip.io");
	});
});

/**
 * A webhook that names a provider must prove it holds that provider's secret.
 * These deliveries trigger deploys, so anything unverified has to fail closed.
 */
describe("provider webhook verification", () => {
	/** Queue results for successive `db.select()...where()` calls. */
	function mockSelects(...results: unknown[][]): void {
		let call = 0;
		(db as unknown as { select: () => unknown }).select = () => ({
			from: () => ({ where: () => Promise.resolve(results[call++] ?? []) }),
		});
	}

	const pushBody = JSON.stringify({
		object_kind: "push",
		ref: "refs/heads/main",
		project: { path_with_namespace: "acme/api" },
		commits: [],
	});

	it("rejects a gitlab delivery when the provider row has no secret", async () => {
		mockSelects([{ gitlabId: "gl1", secret: null }]);
		await expect(
			handleGitWebhook("gitlab", { "x-gitlab-token": "anything" }, pushBody, "gl1"),
		).rejects.toBeInstanceOf(WebhookUnauthorized);
	});

	it("rejects a gitlab delivery with no token at all", async () => {
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }]);
		await expect(handleGitWebhook("gitlab", {}, pushBody, "gl1")).rejects.toBeInstanceOf(
			WebhookUnauthorized,
		);
	});

	it("rejects a gitlab delivery whose token does not match", async () => {
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }]);
		await expect(
			handleGitWebhook("gitlab", { "x-gitlab-token": "wrong!" }, pushBody, "gl1"),
		).rejects.toBeInstanceOf(WebhookUnauthorized);
	});

	it("accepts a gitlab delivery with the matching token", async () => {
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }]);
		// Verification passes, then the unsupported event is ignored — proving
		// the delivery got past authentication.
		await expect(
			handleGitWebhook(
				"gitlab",
				{ "x-gitlab-token": "s3cret" },
				JSON.stringify({ object_kind: "issue" }),
				"gl1",
			),
		).rejects.toBeInstanceOf(WebhookIgnored);
	});

	it("rejects a gitlab delivery with no provider id and no token", async () => {
		await expect(handleGitWebhook("gitlab", {}, pushBody)).rejects.toBeInstanceOf(
			WebhookUnauthorized,
		);
	});

	it("carries the provider and head commit of a verified push delivery", async () => {
		// Provider row, then the (empty) application candidate list.
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }], []);
		const result = await handleGitWebhook(
			"gitlab",
			{ "x-gitlab-token": "s3cret" },
			JSON.stringify({
				object_kind: "push",
				ref: "refs/heads/main",
				checkout_sha: "0123456789abcdef0123456789abcdef01234567",
				user_name: "Pusher",
				project: { path_with_namespace: "acme/api" },
				// GitLab lists commits oldest-first, so the head is the last entry.
				commits: [
					{ id: "1111111", message: "older", author: { name: "Old" } },
					{
						id: "0123456789abcdef0123456789abcdef01234567",
						message: "feat: head\n\nbody",
						author: { name: "Jane" },
					},
				],
			}),
			"gl1",
		);
		expect(result.provider).toBe("gitlab");
		expect(result.type).toBe("push");
		expect(result.commit).toEqual({
			sha: "0123456789abcdef0123456789abcdef01234567",
			message: "feat: head\n\nbody",
			author: "Jane",
		});
		expect(webhookProvenance(result)).toEqual({
			trigger: "webhook",
			triggeredBy: "webhook:gitlab",
			commitSha: "0123456789abcdef0123456789abcdef01234567",
			commitMessage: "feat: head\n\nbody",
			commitAuthor: "Jane",
		});
	});

	it("rejects a gitea delivery with no signature header", async () => {
		mockSelects([{ giteaId: "gt1", accessToken: "tok" }]);
		await expect(
			handleGitWebhook("gitea", { "x-gitea-event": "push" }, pushBody, "gt1"),
		).rejects.toBeInstanceOf(WebhookUnauthorized);
	});

	it("rejects a gitea delivery whose signature does not match", async () => {
		mockSelects([{ giteaId: "gt1", accessToken: "tok" }]);
		await expect(
			handleGitWebhook(
				"gitea",
				{ "x-gitea-event": "push", "x-gitea-signature": "00".repeat(32) },
				pushBody,
				"gt1",
			),
		).rejects.toBeInstanceOf(WebhookUnauthorized);
	});

	const mergeRequestBody = (attrs: Record<string, unknown>) =>
		JSON.stringify({
			object_kind: "merge_request",
			project: { path_with_namespace: "acme/api" },
			user: { username: "dev" },
			object_attributes: {
				iid: 7,
				id: 700,
				source_branch: "feat",
				title: "Feature",
				source_project_id: 1,
				target_project_id: 1,
				...attrs,
			},
		});

	it("ignores a gitlab merge_request `update` without oldrev (metadata-only edit)", async () => {
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }], []);
		await expect(
			handleGitWebhook(
				"gitlab",
				{ "x-gitlab-token": "s3cret" },
				mergeRequestBody({ action: "update" }),
				"gl1",
			),
		).rejects.toThrow(/oldrev/);
	});

	it("handles a gitlab merge_request `update` that carries oldrev (a push)", async () => {
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }], []);
		const result = await handleGitWebhook(
			"gitlab",
			{ "x-gitlab-token": "s3cret" },
			mergeRequestBody({ action: "update", oldrev: "0123456789abcdef" }),
			"gl1",
		);
		expect(result.type).toBe("pull_request");
		expect(result.pullRequest?.sourceRef).toBe("feat");
	});

	it("points fork merge requests at the provider's MR head ref", async () => {
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }], []);
		const result = await handleGitWebhook(
			"gitlab",
			{ "x-gitlab-token": "s3cret" },
			mergeRequestBody({ action: "open", source_project_id: 2, target_project_id: 1 }),
			"gl1",
		);
		expect(result.pullRequest?.isFork).toBe(true);
		expect(result.pullRequest?.sourceRef).toBe("refs/merge-requests/7/head");
	});

	it("matches compose services with previews enabled, not only applications", async () => {
		mockSelects(
			[{ gitlabId: "gl1", secret: "s3cret" }],
			// applications: none
			[],
			// compose: one repo match, one for a different repository
			[
				{
					composeId: "cmp-1",
					sourceType: "gitlab",
					repository: "api",
					owner: "ACME",
					isPreviewDeploymentsActive: true,
				},
				{
					composeId: "cmp-2",
					sourceType: "gitlab",
					repository: "other",
					owner: "acme",
					isPreviewDeploymentsActive: true,
				},
			],
		);
		const result = await handleGitWebhook(
			"gitlab",
			{ "x-gitlab-token": "s3cret" },
			mergeRequestBody({ action: "open" }),
			"gl1",
		);
		expect(result.applicationIds).toEqual([]);
		// Owner comparison is case-insensitive, repository is exact.
		expect(result.composeIds).toEqual(["cmp-1"]);
	});

	it("never names a compose service on a push delivery (previews only)", async () => {
		mockSelects([{ gitlabId: "gl1", secret: "s3cret" }], []);
		const result = await handleGitWebhook(
			"gitlab",
			{ "x-gitlab-token": "s3cret" },
			pushBody,
			"gl1",
		);
		expect(result.type).toBe("push");
		expect(result.composeIds).toEqual([]);
	});

	it("accepts a gitea delivery signed with the dedicated webhook secret", async () => {
		mockSelects([{ giteaId: "gt1", accessToken: "tok" }]);
		const body = JSON.stringify({ some: "payload" });
		const { derivedWebhookSecret } = await import("./webhook-secret");
		const secret = derivedWebhookSecret("gitea", "gt1");
		const signature = createHmac("sha256", secret).update(body).digest("hex");
		await expect(
			handleGitWebhook(
				"gitea",
				{ "x-gitea-event": "issues", "x-gitea-signature": signature },
				body,
				"gt1",
			),
		).rejects.toBeInstanceOf(WebhookIgnored);
	});
});
