import { describe, expect, it } from "vitest";
import { traefikAppName } from "../compose/commands";
import { privateNetworkName } from "../compose/rewrite";
import type { ComposeRow } from "../compose/source";
import { buildPreviewComposeTarget } from "./compose";
import { previewAppName } from "./naming";

/**
 * A compose preview is a whole project forked off the parent row: everything
 * downstream (`prepareComposeFiles`, the deploy command, the network
 * injection, the Traefik keys) is keyed on `appName` and `env`, so these two
 * fields are the entire contract.
 */

const row = {
	composeId: "cmp-1",
	name: "shop",
	appName: "shop-9f00aa",
	description: null,
	env: "DATABASE_URL=postgres://prod\nLOG_LEVEL=info",
	status: "running",
	composeType: "docker-compose",
	composeFile: "",
	sourceType: "github",
	repository: "shop",
	owner: "acme",
	branch: "main",
	composePath: "./compose.yaml",
	autoDeploy: true,
	watchPaths: null,
	buildEnabled: false,
	publishPorts: false,
	buildArgs: null,
	isPreviewDeploymentsActive: true,
	previewForksRequireApproval: true,
	previewEnv: null,
	previewLimit: 3,
	previewTtlHours: null,
	gitUrl: null,
	gitBranch: null,
	customGitSSHKeyId: null,
	githubId: "gh-1",
	gitlabId: null,
	bitbucketId: null,
	giteaId: null,
	preDeployCommand: null,
	postDeployCommand: null,
	isolatedDeployment: false,
	suffix: "",
	hostPrivileged: false,
	environmentId: "env-1",
	serverId: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
} satisfies ComposeRow;

const preview = (branch: string | null) => ({
	appName: previewAppName(row.appName, "7"),
	branch,
});

describe("buildPreviewComposeTarget", () => {
	it("renames the project so nothing can collide with production", () => {
		const target = buildPreviewComposeTarget(row, preview("feature/x"));
		expect(target.appName).toBe("shop-9f00aa-pr-7");
		expect(target.composeId).toBe(row.composeId);
		// The private network, the Traefik key and the shared-overlay alias are
		// all derived from appName — so all three are preview-scoped for free.
		expect(privateNetworkName(target.appName)).toBe("shop-9f00aa-pr-7-net");
		expect(privateNetworkName(target.appName)).not.toBe(privateNetworkName(row.appName));
		expect(traefikAppName(target, "web")).toBe("shop-9f00aa-pr-7-web");
		expect(traefikAppName(target, "web")).not.toBe(traefikAppName(row, "web"));
	});

	it("merges previewEnv over the service env layer, keeping the other keys", () => {
		const target = buildPreviewComposeTarget(
			{ ...row, previewEnv: "DATABASE_URL=postgres://scratch\nPREVIEW=1" },
			preview("feature/x"),
		);
		expect(target.env?.split("\n").sort()).toEqual([
			"DATABASE_URL=postgres://scratch",
			"LOG_LEVEL=info",
			"PREVIEW=1",
		]);
	});

	it("leaves the env untouched when the row has no previewEnv", () => {
		expect(buildPreviewComposeTarget(row, preview("feature/x")).env).toBe(row.env);
	});

	it("points a same-repo PR at its branch", () => {
		const target = buildPreviewComposeTarget(row, preview("feature/x"));
		expect(target.branch).toBe("feature/x");
		expect(target.gitBranch).toBe("feature/x");
		expect(target.owner).toBe("acme");
		expect(target.repository).toBe("shop");
	});

	it("fetches the provider PR head ref for a fork on GitHub/GitLab/Gitea", () => {
		const target = buildPreviewComposeTarget(row, preview("refs/pull/7/head"));
		expect(target.branch).toBe("refs/pull/7/head");
		expect(target.gitBranch).toBe("refs/pull/7/head");
		expect(target.repository).toBe("shop");
	});

	it("clones the fork repository for Bitbucket fork PRs", () => {
		const target = buildPreviewComposeTarget(row, preview("fork:outsider/shop:patch-1"));
		expect(target.owner).toBe("outsider");
		expect(target.repository).toBe("shop");
		expect(target.branch).toBe("patch-1");
	});

	it("falls back to the parent's own source when the preview has no ref", () => {
		const target = buildPreviewComposeTarget(row, preview(null));
		expect(target.branch).toBe("main");
	});

	it("drops the isolation suffix — the preview project name is already unique", () => {
		const target = buildPreviewComposeTarget(
			{ ...row, isolatedDeployment: true, suffix: "ab12cd" },
			preview("feature/x"),
		);
		expect(target.isolatedDeployment).toBe(false);
		expect(target.suffix).toBe("");
		// Without this, the Traefik key the preview route is written under would
		// not match the service name the deploy renders.
		expect(traefikAppName(target, "web")).toBe("shop-9f00aa-pr-7-web");
	});

	it("keeps the stack naming convention for stack rows", () => {
		const target = buildPreviewComposeTarget(
			{ ...row, composeType: "stack" },
			preview("feature/x"),
		);
		expect(traefikAppName(target, "web")).toBe("shop-9f00aa-pr-7_web");
	});
});
