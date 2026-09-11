import { describe, expect, it } from "vitest";

import { anyDirty, draftKey } from "@/hooks/use-draft";

describe("draftKey", () => {
	it("gives equal values the same identity", () => {
		expect(draftKey({ a: 1, b: "x" })).toBe(draftKey({ a: 1, b: "x" }));
		expect(draftKey(["a", "b"])).toBe(draftKey(["a", "b"]));
		expect(draftKey("")).toBe(draftKey(""));
	});

	it("separates values that differ", () => {
		expect(draftKey({ a: 1 })).not.toBe(draftKey({ a: 2 }));
		// Key order is part of the JSON shape — callers build the seed object in
		// one place, so this only costs a re-seed, never a lost edit.
		expect(draftKey({ a: 1, b: 2 })).not.toBe(draftKey({ b: 2, a: 1 }));
		expect(draftKey("1")).not.toBe(draftKey(1));
		expect(draftKey(null)).not.toBe(draftKey(undefined));
	});

	it("survives values JSON cannot serialize", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => draftKey(circular)).not.toThrow();
		expect(draftKey(undefined)).toBe("undefined");
	});
});

describe("anyDirty", () => {
	it("is true when at least one draft holds edits", () => {
		expect(anyDirty({ dirty: false }, { dirty: true })).toBe(true);
		expect(anyDirty({ dirty: false }, { dirty: false })).toBe(false);
		expect(anyDirty()).toBe(false);
	});
});
