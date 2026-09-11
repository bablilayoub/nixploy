import { describe, expect, it } from "vitest";
import { parseAuditWindow } from "./audit";

/**
 * `audit.all --since` used to be a client-side filter over whatever page the
 * CLI happened to fetch (CLI/MCP audit handoff §6), which silently lost events
 * older than `--limit` rows. The window is now a real SQL predicate, so the
 * string → instant conversion is what has to be right.
 */
describe("parseAuditWindow", () => {
	const now = new Date("2026-09-11T12:00:00.000Z");

	it("reads relative minute, hour and day windows", () => {
		expect(parseAuditWindow("30m", now)?.toISOString()).toBe("2026-09-11T11:30:00.000Z");
		expect(parseAuditWindow("1h", now)?.toISOString()).toBe("2026-09-11T11:00:00.000Z");
		expect(parseAuditWindow("24h", now)?.toISOString()).toBe("2026-09-10T12:00:00.000Z");
		expect(parseAuditWindow("7d", now)?.toISOString()).toBe("2026-09-04T12:00:00.000Z");
	});

	it("tolerates surrounding whitespace", () => {
		expect(parseAuditWindow("  24h  ", now)?.toISOString()).toBe("2026-09-10T12:00:00.000Z");
	});

	it("reads an absolute ISO timestamp", () => {
		expect(parseAuditWindow("2026-09-01T00:00:00Z", now)?.toISOString()).toBe(
			"2026-09-01T00:00:00.000Z",
		);
		expect(parseAuditWindow("2026-09-01", now)?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
	});

	it("rejects anything it cannot turn into an instant", () => {
		expect(parseAuditWindow("yesterday", now)).toBeNull();
		expect(parseAuditWindow("7w", now)).toBeNull();
		expect(parseAuditWindow("", now)).toBeNull();
		expect(parseAuditWindow("-1h", now)).toBeNull();
	});
});
