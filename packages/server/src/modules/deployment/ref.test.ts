import { describe, expect, it } from "vitest";
import { isDomainError } from "../errors";
import { resolveRequestedRef } from "./ref";

const git = { sourceType: "github" };

describe("resolveRequestedRef", () => {
	it("returns undefined when no ref was asked for", () => {
		expect(resolveRequestedRef(git, undefined)).toBeUndefined();
		expect(resolveRequestedRef(git, null)).toBeUndefined();
		expect(resolveRequestedRef(git, "")).toBeUndefined();
		expect(resolveRequestedRef(git, "   ")).toBeUndefined();
	});

	it("accepts branches, tags and shas, trimmed", () => {
		expect(resolveRequestedRef(git, "main")).toBe("main");
		expect(resolveRequestedRef(git, " v1.2.0 ")).toBe("v1.2.0");
		expect(resolveRequestedRef(git, "feature/checkout")).toBe("feature/checkout");
		expect(resolveRequestedRef(git, "4f2a9c1d8e3b5a7c9f1e2d4b6a8c0e2f4a6b8c0d")).toBe(
			"4f2a9c1d8e3b5a7c9f1e2d4b6a8c0e2f4a6b8c0d",
		);
	});

	it("accepts every git source type", () => {
		for (const sourceType of ["git", "github", "gitlab", "bitbucket", "gitea"]) {
			expect(resolveRequestedRef({ sourceType }, "main")).toBe("main");
		}
	});

	it("refuses a ref on a source with no checkout instead of ignoring it", () => {
		// Silently dropping it would deploy the wrong thing and report success.
		expect(() => resolveRequestedRef({ sourceType: "docker" }, "v1.2.0")).toThrow(
			/no git ref to deploy/,
		);
		expect(() => resolveRequestedRef({ sourceType: "drop" }, "v1.2.0")).toThrow(
			/no git ref to deploy/,
		);
	});

	it("still returns undefined for a blank ref on a non-git source", () => {
		expect(resolveRequestedRef({ sourceType: "docker" }, undefined)).toBeUndefined();
	});

	it("rejects refs that could reach the shell or git's option parser", () => {
		for (const bad of ["--upload-pack=evil", "-x", "a b", "main;rm -rf /", "a..b", "ref@{0}"]) {
			expect(() => resolveRequestedRef(git, bad), bad).toThrow();
		}
	});

	it("reports a bad ref as a client error, not a 500", () => {
		try {
			resolveRequestedRef(git, "--upload-pack=evil");
			expect.unreachable();
		} catch (error) {
			expect(isDomainError(error) && error.code).toBe("BAD_REQUEST");
		}
	});
});
