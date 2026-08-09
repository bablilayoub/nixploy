import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../deployment", () => ({ queueDeployment: vi.fn() }));
vi.mock("../application/paths", () => ({
	getWildcardDomain: () => "nip.io",
}));
vi.mock("../application/docker", () => ({
	removeSwarmService: vi.fn(),
}));
vi.mock("../traefik", () => ({
	writeAppTraefikConfig: vi.fn(),
	removeTraefikConfig: vi.fn(),
}));

import { createHmac } from "node:crypto";
import { db } from "../../db";
import { classifyPullRequestAction, previewAppName, previewHost } from "../preview";
import {
	applicationMatchesPreviewWebhook,
	applicationMatchesWebhook,
	handleGitWebhook,
	type PreviewWebhookCandidate,
	type WebhookApplicationCandidate,
	WebhookIgnored,
	type WebhookRepoContext,
	WebhookUnauthorized,
	watchPathsMatch,
} from "./webhook-handler";

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
});

describe("applicationMatchesWebhook", () => {
	const baseApp: WebhookApplicationCandidate = {
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
		expect(applicationMatchesWebhook(baseApp, baseWebhook)).toBe(true);
	});

	it("rejects a different branch, repository, provider or auto-deploy off", () => {
		expect(applicationMatchesWebhook(baseApp, { ...baseWebhook, branch: "develop" })).toBe(false);
		expect(applicationMatchesWebhook(baseApp, { ...baseWebhook, repository: "other" })).toBe(false);
		expect(applicationMatchesWebhook({ ...baseApp, sourceType: "gitlab" }, baseWebhook)).toBe(
			false,
		);
		expect(applicationMatchesWebhook({ ...baseApp, autoDeploy: false }, baseWebhook)).toBe(false);
	});

	it("rejects when the owner differs or the app has no repository", () => {
		expect(applicationMatchesWebhook(baseApp, { ...baseWebhook, owner: "someone-else" })).toBe(
			false,
		);
		expect(applicationMatchesWebhook({ ...baseApp, repository: null }, baseWebhook)).toBe(false);
	});

	it("applies watch paths against the delivery's changed files", () => {
		const watched = { ...baseApp, watchPaths: ["src"] };
		expect(applicationMatchesWebhook(watched, { ...baseWebhook, changedPaths: ["src/a.ts"] })).toBe(
			true,
		);
		expect(
			applicationMatchesWebhook(watched, { ...baseWebhook, changedPaths: ["docs/b.md"] }),
		).toBe(false);
		// No file list in the delivery (e.g. Bitbucket) → deploy.
		expect(applicationMatchesWebhook(watched, baseWebhook)).toBe(true);
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
