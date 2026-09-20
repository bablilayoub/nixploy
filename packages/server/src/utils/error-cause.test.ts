import { describe, expect, it } from "vitest";
import { describeErrorWithCause } from "./error-cause";

describe("describeErrorWithCause", () => {
	it("keeps the reason drizzle hides behind the SQL", () => {
		// The shape seen in production on 2026-09-20.
		const driver = new Error("terminating connection due to administrator command");
		const query = new Error(
			'Failed query: select distinct "metric" from "alert_rule" where "enabled" = $1\nparams: true',
			{ cause: driver },
		);
		const text = describeErrorWithCause(query);
		expect(text).toContain("Failed query:");
		expect(text).toContain("cause: terminating connection due to administrator command");
	});

	it("is the plain message when there is no cause", () => {
		expect(describeErrorWithCause(new Error("boom"))).toBe("boom");
	});

	it("stringifies a non-error and a non-error cause", () => {
		expect(describeErrorWithCause("just a string")).toBe("just a string");
		expect(describeErrorWithCause(42)).toBe("42");
		expect(describeErrorWithCause(new Error("outer", { cause: "inner reason" }))).toBe(
			"outer — cause: inner reason",
		);
		expect(describeErrorWithCause(new Error("outer", { cause: { code: 42 } }))).toBe("outer");
	});

	it("follows a chain, bounded, without repeating itself", () => {
		const deepest = new Error("d");
		const third = new Error("c", { cause: deepest });
		const second = new Error("b", { cause: third });
		const first = new Error("a", { cause: second });
		expect(describeErrorWithCause(first)).toBe("a — cause: b — cause: c — cause: d");

		const tooDeep = new Error("1", {
			cause: new Error("2", { cause: new Error("3", { cause: new Error("4") }) }),
		});
		expect(describeErrorWithCause(tooDeep)).toBe("1 — cause: 2 — cause: 3 — cause: 4");
	});

	it("does not repeat a cause that restates its wrapper", () => {
		const inner = new Error("connection refused");
		const outer = new Error("query failed: connection refused", { cause: inner });
		expect(describeErrorWithCause(outer)).toBe("query failed: connection refused");
	});

	it("survives a cause cycle", () => {
		const a = new Error("a");
		const b = new Error("b", { cause: a });
		(a as { cause?: unknown }).cause = b;
		expect(describeErrorWithCause(a)).toBe("a — cause: b");
	});
});
