import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatBytes, formatDateTime, formatDuration, formatRelative } from "@/lib/format";

describe("formatBytes", () => {
	it("uses binary units with one decimal", () => {
		expect(formatBytes(512)).toBe("512.0 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
		expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
	});

	it("clamps at terabytes and treats non-positive input as zero", () => {
		expect(formatBytes(2048 * 1024 ** 4)).toBe("2048.0 TB");
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(-1)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
	});
});

describe("formatDuration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns an em dash when the deployment never started", () => {
		expect(formatDuration(null, null)).toBe("—");
		expect(formatDuration(null, "2026-09-10T12:00:00Z")).toBe("—");
	});

	it("formats seconds below a minute and m/s above", () => {
		expect(formatDuration("2026-09-10T11:59:15Z", "2026-09-10T12:00:00Z")).toBe("45s");
		expect(formatDuration("2026-09-10T11:56:48Z", "2026-09-10T12:00:00Z")).toBe("3m 12s");
		expect(formatDuration("2026-09-10T11:59:00Z", "2026-09-10T12:00:00Z")).toBe("1m 0s");
	});

	it("measures an unfinished deployment up to now and never goes negative", () => {
		expect(formatDuration("2026-09-10T11:59:30Z", null)).toBe("30s");
		expect(formatDuration("2026-09-10T12:00:10Z", "2026-09-10T12:00:00Z")).toBe("0s");
	});
});

describe("formatDateTime", () => {
	it("renders a 24-hour timestamp in the viewer's timezone", () => {
		// No trailing Z: parsed as local time, so the assertion is tz-independent.
		expect(formatDateTime("2026-09-10T14:05:00")).toBe("Sep 10, 2026 14:05");
		expect(formatDateTime(new Date(2026, 0, 2, 9, 7))).toBe("Jan 2, 2026 09:07");
	});

	it("returns an em dash for unparseable input", () => {
		expect(formatDateTime("not a date")).toBe("—");
	});
});

describe("formatRelative", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("adds a suffix in both directions", () => {
		expect(formatRelative("2026-09-10T09:00:00Z")).toBe("about 3 hours ago");
		expect(formatRelative("2026-09-12T12:00:00Z")).toBe("in 2 days");
	});

	it("returns an em dash for unparseable input", () => {
		expect(formatRelative("nope")).toBe("—");
	});
});
