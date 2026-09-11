import { describe, expect, it } from "vitest";
import { buildCommitUrl, webRepoFromGitUrl } from "./commit-url";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("buildCommitUrl", () => {
	it("links GitHub without a provider base URL", () => {
		expect(
			buildCommitUrl({ sourceType: "github", owner: "nixploy", repository: "panel" }, SHA),
		).toBe(`https://github.com/nixploy/panel/commit/${SHA}`);
	});

	it("uses the provider row for gitlab.com", () => {
		expect(
			buildCommitUrl(
				{
					sourceType: "gitlab",
					owner: "group",
					repository: "app",
					providerUrl: "https://gitlab.com",
				},
				SHA,
			),
		).toBe(`https://gitlab.com/group/app/-/commit/${SHA}`);
	});

	it("uses the provider row for self-hosted GitLab (and strips a trailing slash)", () => {
		expect(
			buildCommitUrl(
				{
					sourceType: "gitlab",
					owner: "team",
					repository: "svc",
					providerUrl: "https://git.internal.example/",
				},
				SHA,
			),
		).toBe(`https://git.internal.example/team/svc/-/commit/${SHA}`);
	});

	it("adds https:// to a bare provider host", () => {
		expect(
			buildCommitUrl(
				{ sourceType: "gitea", owner: "ops", repository: "infra", providerUrl: "git.example.org" },
				SHA,
			),
		).toBe(`https://git.example.org/ops/infra/commit/${SHA}`);
	});

	it("returns null for self-hosted providers without a base URL", () => {
		expect(buildCommitUrl({ sourceType: "gitlab", owner: "g", repository: "a" }, SHA)).toBeNull();
		expect(buildCommitUrl({ sourceType: "gitea", owner: "g", repository: "a" }, SHA)).toBeNull();
	});

	it("defaults Bitbucket to the cloud host and honours a self-hosted one", () => {
		expect(
			buildCommitUrl({ sourceType: "bitbucket", owner: "space", repository: "repo" }, SHA),
		).toBe(`https://bitbucket.org/space/repo/commits/${SHA}`);
		expect(
			buildCommitUrl(
				{
					sourceType: "bitbucket",
					owner: "space",
					repository: "repo",
					providerUrl: "https://bb.example.net",
				},
				SHA,
			),
		).toBe(`https://bb.example.net/space/repo/commits/${SHA}`);
	});

	it("derives a base from an https git remote", () => {
		expect(
			buildCommitUrl({ sourceType: "git", gitUrl: "https://git.example.com/team/app.git" }, SHA),
		).toBe(`https://git.example.com/team/app/commit/${SHA}`);
	});

	it("derives a base from an scp-style ssh remote", () => {
		expect(
			buildCommitUrl({ sourceType: "git", gitUrl: "git@github.com:owner/repo.git" }, SHA),
		).toBe(`https://github.com/owner/repo/commit/${SHA}`);
	});

	it("derives a base from an ssh:// remote with a port", () => {
		expect(
			buildCommitUrl({ sourceType: "git", gitUrl: "ssh://git@git.example.com:2222/o/r.git" }, SHA),
		).toBe(`https://git.example.com/o/r/commit/${SHA}`);
	});

	it("returns null for sources that cannot have a commit page", () => {
		expect(buildCommitUrl({ sourceType: "docker" }, "sha256:abcdef")).toBeNull();
		expect(buildCommitUrl({ sourceType: "drop" }, SHA)).toBeNull();
		expect(buildCommitUrl({ sourceType: "raw" }, SHA)).toBeNull();
		expect(buildCommitUrl({ sourceType: "git", gitUrl: null }, SHA)).toBeNull();
		expect(buildCommitUrl({ sourceType: "github", owner: "only-owner" }, SHA)).toBeNull();
	});

	it("returns null for an empty sha", () => {
		expect(buildCommitUrl({ sourceType: "github", owner: "a", repository: "b" }, "   ")).toBeNull();
	});

	it("trims stray slashes around owner/repository", () => {
		expect(buildCommitUrl({ sourceType: "github", owner: "/a/", repository: "/b/" }, SHA)).toBe(
			`https://github.com/a/b/commit/${SHA}`,
		);
	});
});

describe("webRepoFromGitUrl", () => {
	it("rejects remotes without an owner/repo pair", () => {
		expect(webRepoFromGitUrl("https://example.com/repo")).toBeNull();
		expect(webRepoFromGitUrl("")).toBeNull();
		expect(webRepoFromGitUrl("file:///srv/git/repo.git")).toBeNull();
	});
});
