import { describe, expect, it } from "vitest";
import { resolveInside } from "./dockerfile";

describe("resolveInside", () => {
	it("resolves plain relative paths inside the build dir", () => {
		expect(resolveInside("/builds/app", "Dockerfile")).toBe("/builds/app/Dockerfile");
		expect(resolveInside("/builds/app", "src/Dockerfile")).toBe("/builds/app/src/Dockerfile");
	});

	it("tolerates a trailing slash on the base (normalize preserves it)", () => {
		// regression: buildPath "/" used to yield a base with a trailing slash,
		// making every resolveInside call throw "Path escapes the build context".
		expect(resolveInside("/builds/app/", "Dockerfile")).toBe("/builds/app/Dockerfile");
	});

	it("returns the base itself for empty/current-dir relatives", () => {
		expect(resolveInside("/builds/app", "")).toBe("/builds/app");
		expect(resolveInside("/builds/app", ".")).toBe("/builds/app");
	});

	it("rejects escapes", () => {
		expect(() => resolveInside("/builds/app", "../secrets")).toThrow(/escapes/);
		expect(() => resolveInside("/builds/app", "../../etc")).toThrow(/escapes/);
	});

	it("keeps absolute-looking input inside the base (no escape)", () => {
		expect(resolveInside("/builds/app", "/etc/passwd")).toBe("/builds/app/etc/passwd");
	});
});
