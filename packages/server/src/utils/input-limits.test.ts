import { describe, expect, it } from "vitest";
import {
	isSafeWatchPathPattern,
	MAX_MOUNT_CONTENT_LENGTH,
	MAX_TEXT_BLOB_LENGTH,
	MAX_WATCH_PATHS,
	mountContentSchema,
	textBlobSchema,
	watchPathsSchema,
} from "./input-limits";

describe("text blob caps", () => {
	it("accepts exactly 1 MiB and rejects one more character", () => {
		expect(textBlobSchema.safeParse("x".repeat(MAX_TEXT_BLOB_LENGTH)).success).toBe(true);
		expect(textBlobSchema.safeParse("x".repeat(MAX_TEXT_BLOB_LENGTH + 1)).success).toBe(false);
	});

	it("caps mount content at 256 KiB", () => {
		expect(MAX_MOUNT_CONTENT_LENGTH).toBe(262_144);
		expect(mountContentSchema.safeParse("x".repeat(MAX_MOUNT_CONTENT_LENGTH)).success).toBe(true);
		expect(mountContentSchema.safeParse("x".repeat(MAX_MOUNT_CONTENT_LENGTH + 1)).success).toBe(
			false,
		);
	});
});

describe("watch path caps", () => {
	it("accepts everyday patterns", () => {
		for (const pattern of [
			"src",
			"src/**",
			"src/**/*.ts",
			"**/*.md",
			"apps/*/src/**/*.tsx",
			"?.txt",
		]) {
			expect(isSafeWatchPathPattern(pattern)).toBe(true);
		}
		expect(watchPathsSchema.safeParse(["src/**", "package.json"]).success).toBe(true);
	});

	it("rejects more than 3 globstars, more than 8 stars, or > 256 characters", () => {
		expect(isSafeWatchPathPattern("**/a/**/b/**/c/**")).toBe(false);
		expect(isSafeWatchPathPattern("a*b*c*d*e*f*g*h*i*")).toBe(false);
		expect(isSafeWatchPathPattern(`${"a".repeat(257)}`)).toBe(false);
		expect(isSafeWatchPathPattern(`${"a".repeat(256)}`)).toBe(true);
	});

	it("rejects a ReDoS pattern and an oversized list through the schema", () => {
		const hostile = "**a**a**a**a**a**a**a**a";
		const result = watchPathsSchema.safeParse([hostile]);
		expect(result.success).toBe(false);
		expect(
			watchPathsSchema.safeParse(Array.from({ length: MAX_WATCH_PATHS }, () => "src")).success,
		).toBe(true);
		expect(
			watchPathsSchema.safeParse(Array.from({ length: MAX_WATCH_PATHS + 1 }, () => "src")).success,
		).toBe(false);
	});
});
