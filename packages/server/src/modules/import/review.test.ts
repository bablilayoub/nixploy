import { describe, expect, it } from "vitest";
import { importReviewToken, redactImportReview, summarizeImportValues } from "./review";

const review = {
	manifest: {
		version: 2,
		project: { name: "shop" },
		applications: [
			{
				name: "api",
				command: "run --password=command-canary",
				dockerfile: "ENV SECRET=dockerfile-canary",
				gitUrl: "https://user:git-canary@example.test/repo",
			},
		],
		compose: [
			{
				name: "stack",
				composeFile: "PASSWORD=compose-canary",
				mounts: [{ content: "mount-canary" }],
			},
		],
	},
	source: { host: "source.test", project: "shop", environment: "production" },
	target: {
		projectName: "shop",
		environmentName: "production",
		projectId: null,
		createsProject: true,
		createsEnvironment: true,
	},
	notes: [],
	counts: { applications: 1, compose: 1, databases: 0, domains: 0, skipped: 0 },
	plan: null,
	reviewToken: "token",
};

describe("import review", () => {
	it("binds values while ignoring equivalent object key order", () => {
		expect(importReviewToken({ b: { secret: "first", field: 1 }, a: [1, 2] })).toBe(
			importReviewToken({ a: [1, 2], b: { field: 1, secret: "first" } }),
		);
		expect(importReviewToken({ secret: "first" })).not.toBe(
			importReviewToken({ secret: "second" }),
		);
		expect(importReviewToken({ organizationId: "a" })).not.toBe(
			importReviewToken({ organizationId: "b" }),
		);
	});
	it("omits executable content and embedded credentials from downloadable reports", () => {
		const result = redactImportReview(
			review as unknown as Parameters<typeof redactImportReview>[0],
		);
		expect(JSON.stringify(result)).not.toContain("canary");
		expect(result.manifest.compose?.[0]?.name).toBe("stack");
		expect(result.manifest.applications?.[0]?.name).toBe("api");
		expect(JSON.stringify(review)).toContain("canary");
	});
});

it("previews shared value replacement, clearing and preservation without values", () => {
	const groups = summarizeImportValues({
		version: 1,
		project: { name: "shop", env: "TOKEN=value-canary" },
		environment: { name: "prod" },
		applications: { web: { env: "", buildArgs: undefined, previewEnv: null } },
		compose: {},
		databases: {},
	});
	expect(groups).toEqual(
		expect.arrayContaining([
			{ target: "project", field: "env", action: "copy", keys: ["TOKEN"] },
			{ target: "environment", field: "env", action: "preserve", keys: [] },
			{ target: "application/web", field: "env", action: "clear", keys: [] },
		]),
	);
	expect(JSON.stringify(groups)).not.toContain("value-canary");
});
