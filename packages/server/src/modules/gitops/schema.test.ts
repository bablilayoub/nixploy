import { describe, expect, it } from "vitest";
import { findDuplicateStackEntries, nixployStackSchema } from "./schema";

describe("nixployStackSchema duplicates", () => {
	it("rejects the same (kind, environment, name) listed twice", () => {
		const parsed = nixployStackSchema.safeParse({
			version: 1,
			project: { name: "demo" },
			applications: [
				{ name: "web", environment: "prod" },
				{ name: "web", environment: "prod" },
			],
		});
		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues[0]?.message).toContain("application/prod/web");
	});

	it("allows the same name across environments and kinds", () => {
		expect(
			findDuplicateStackEntries({
				applications: [
					{ name: "web", environment: "prod" },
					{ name: "web", environment: "staging" },
				],
				compose: [{ name: "web", environment: "prod" }],
				databases: { postgres: [{ name: "web", environment: "prod" }] },
			}),
		).toEqual([]);
		expect(
			findDuplicateStackEntries({
				databases: {
					postgres: [
						{ name: "db", environment: "prod" },
						{ name: "db", environment: "prod" },
					],
				},
			}),
		).toEqual(["postgres/prod/db"]);
	});
});
