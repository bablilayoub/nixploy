import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-next-path";

describe("safeNextPath", () => {
	it("keeps in-app paths", () => {
		expect(safeNextPath("/dashboard/projects/abc")).toBe("/dashboard/projects/abc");
		expect(safeNextPath("/settings/profile")).toBe("/settings/profile");
		expect(safeNextPath("/")).toBe("/");
	});

	it("falls back to the dashboard for empty input", () => {
		expect(safeNextPath(null)).toBe("/dashboard");
		expect(safeNextPath(undefined)).toBe("/dashboard");
		expect(safeNextPath("")).toBe("/dashboard");
	});

	it("rejects absolute and protocol-relative URLs", () => {
		expect(safeNextPath("https://evil.test/dashboard")).toBe("/dashboard");
		expect(safeNextPath("//evil.test")).toBe("/dashboard");
		expect(safeNextPath("/\\evil.test")).toBe("/dashboard");
		expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
	});

	it("rejects encoded separators and userinfo tricks", () => {
		expect(safeNextPath("/%2fevil.test")).toBe("/dashboard");
		expect(safeNextPath("/%2Fevil.test")).toBe("/dashboard");
		expect(safeNextPath("/%5cevil.test")).toBe("/dashboard");
		expect(safeNextPath("/%5Cevil.test")).toBe("/dashboard");
		expect(safeNextPath("/@evil.test")).toBe("/dashboard");
	});

	it("rejects anything outside the allowed path alphabet", () => {
		// Query strings and fragments are not preserved by the auth pages.
		expect(safeNextPath("/dashboard?next=x")).toBe("/dashboard");
		expect(safeNextPath("/dashboard#frag")).toBe("/dashboard");
		expect(safeNextPath("/dash board")).toBe("/dashboard");
	});
});
