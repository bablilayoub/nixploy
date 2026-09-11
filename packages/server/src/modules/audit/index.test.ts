import { describe, expect, it } from "vitest";
import { AUDIT_CSV_COLUMNS, auditRowsToCsv, formatForwardedAudit } from "./index";

describe("auditRowsToCsv", () => {
	it("writes a header and one quoted line per row", () => {
		const csv = auditRowsToCsv([
			{
				createdAt: new Date("2026-09-11T10:00:00.000Z"),
				organizationId: "org_1",
				organizationName: "Acme",
				actorId: "user_1",
				actorEmail: "a@example.test",
				action: "backup.restore",
				targetType: "backup",
				targetId: "b_1",
				targetName: "nightly",
				ip: "203.0.113.7",
				userAgent: "curl/8",
				metadata: '{"key":"value"}',
			},
		]);
		const lines = csv.trimEnd().split("\n");
		expect(lines[0]).toBe(AUDIT_CSV_COLUMNS.join(","));
		expect(lines[1]).toContain('"2026-09-11T10:00:00.000Z"');
		expect(lines[1]).toContain('"backup.restore"');
		expect(lines[1]).toContain('"{""key"":""value""}"');
	});

	it("renders nulls as empty cells", () => {
		const csv = auditRowsToCsv([{ action: "project.create" }]);
		expect(csv.trimEnd().split("\n")[1]).toBe(',,,,,"project.create",,,,,,');
	});

	it("neutralises spreadsheet formulas in tenant-controlled text", () => {
		const csv = auditRowsToCsv([{ action: "x", targetName: "=1+1" }]);
		expect(csv).toContain(`"'=1+1"`);
	});
});

describe("formatForwardedAudit", () => {
	it("summarises a batch, one line per event", () => {
		expect(
			formatForwardedAudit([
				{ action: "member.remove", actorEmail: "admin@x.test", targetName: "bob", ip: "1.2.3.4" },
				{ action: "backup.restore", actorId: "user_2", targetId: "b_1" },
				{ action: "cron.prune" },
			]),
		).toBe(
			"admin@x.test member.remove bob from 1.2.3.4\nuser_2 backup.restore b_1\nsystem cron.prune",
		);
	});

	it("names the overflow and hides an unknown IP", () => {
		expect(formatForwardedAudit([{ action: "a", ip: "unknown" }], 7)).toBe("system a\n…and 7 more");
	});
});
