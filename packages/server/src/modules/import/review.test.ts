import { describe, expect, it } from "vitest";
import { DATABASE_KINDS } from "../services/kinds";
import {
	importReviewToken,
	orderImportReviewServices,
	redactImportReview,
	summarizeImportValues,
} from "./review";

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
	it("ignores unordered target service rows in both token snapshots while retaining values and nested order", () => {
		const live = {
			applications: [
				{ name: "web", row: { healthCheck: { Test: ["CMD", "curl", "-f", "/health"] } } },
				{ name: "api", row: { healthCheck: { Test: ["CMD", "true"] } } },
			],
			compose: [{ name: "worker" }, { name: "cache" }],
			databases: Object.fromEntries(
				DATABASE_KINDS.map((kind) => [kind, [{ name: "second" }, { name: "first" }]]),
			),
		};
		const targetValues = {
			project: "SHARED=original",
			environment: "ENV=original",
			applications: [
				{ name: "web", env: "TOKEN=original" },
				{ name: "api", env: null },
			],
			compose: [
				{ name: "worker", env: "TOKEN=original" },
				{ name: "cache", env: null },
			],
			databases: Object.fromEntries(
				DATABASE_KINDS.map((kind) => [
					kind,
					[
						{ name: "second", env: "TOKEN=original" },
						{ name: "first", env: null },
					],
				]),
			),
		};
		const reverseRows = <T extends typeof live | typeof targetValues>(snapshot: T): T => ({
			...snapshot,
			applications: [...snapshot.applications].reverse(),
			compose: [...snapshot.compose].reverse(),
			databases: Object.fromEntries(
				Object.entries(snapshot.databases).map(([kind, rows]) => [kind, [...rows].reverse()]),
			),
		});
		const token = (currentLive = live, currentValues = targetValues) =>
			importReviewToken({
				live: orderImportReviewServices(currentLive),
				targetValues: orderImportReviewServices(currentValues),
			});
		const original = token();
		// PostgreSQL may return a different physical order after a status-only UPDATE.
		expect(token(reverseRows(live))).toBe(original);
		expect(token(live, reverseRows(targetValues))).toBe(original);
		expect(token(reverseRows(live), reverseRows(targetValues))).toBe(original);
		expect(live.applications.map((row) => row.name)).toEqual(["web", "api"]);
		expect(targetValues.compose.map((row) => row.name)).toEqual(["worker", "cache"]);
		expect(
			token(live, {
				...targetValues,
				applications: targetValues.applications.map((row) =>
					row.name === "web" ? { ...row, env: "TOKEN=changed" } : row,
				),
			}),
		).not.toBe(original);
		expect(
			token({
				...live,
				applications: live.applications.map((row) => ({
					...row,
					row: { healthCheck: { Test: [...row.row.healthCheck.Test].reverse() } },
				})),
			}),
		).not.toBe(original);
	});
	it("orders duplicate-name target rows by their full canonical values", () => {
		const rows = [
			{ name: "duplicate", env: "TOKEN=first" },
			{ name: "duplicate", env: null },
		];
		const live = { applications: rows, compose: rows, databases: { postgres: rows } };
		const targetValues = { ...live, project: "SHARED=original" };
		const reordered = {
			applications: [...rows].reverse(),
			compose: [...rows].reverse(),
			databases: { postgres: [...rows].reverse() },
		};
		expect(
			importReviewToken({
				live: orderImportReviewServices(live),
				targetValues: orderImportReviewServices(targetValues),
			}),
		).toBe(
			importReviewToken({
				live: orderImportReviewServices(reordered),
				targetValues: orderImportReviewServices({ ...targetValues, ...reordered }),
			}),
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
