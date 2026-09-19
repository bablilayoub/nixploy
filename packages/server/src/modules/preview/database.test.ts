import { describe, expect, it } from "vitest";
import { isLogicalKind, previewDatabaseIdentifiers } from "./database";

describe("preview databases", () => {
	it("names the database after the preview's service name, in the engines' alphabet", () => {
		expect(previewDatabaseIdentifiers("shop-a1b2c3-pr-12")).toEqual({
			name: "shop_a1b2c3_pr_12",
			username: "shop_a1b2c3_pr_12_u",
		});
		expect(previewDatabaseIdentifiers("9lives-pr-b1a2c3").name).toBe("p_9lives_pr_b1a2c3");
		const long = previewDatabaseIdentifiers(`${"a".repeat(70)}-pr-1`);
		expect(long.name).toHaveLength(63);
		expect(long.username).toHaveLength(63);
		expect(long.username.endsWith("_u")).toBe(true);
	});

	it("only the four engines with logical databases qualify", () => {
		expect(isLogicalKind("postgres")).toBe(true);
		expect(isLogicalKind("mongo")).toBe(true);
		expect(isLogicalKind("redis")).toBe(false);
		expect(isLogicalKind(null)).toBe(false);
	});
});
