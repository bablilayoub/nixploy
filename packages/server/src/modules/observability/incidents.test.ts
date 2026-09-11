import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Incident lifecycle (ops-dx #19: `modules/observability` had no tests for it).
 *
 * The distinction that matters is acknowledge vs resolve: acknowledging is the
 * "someone is looking at it" signal and must leave the incident OPEN, while
 * resolving closes it and backfills the acknowledgement. Both are idempotent
 * and both are org-scoped.
 */

const fake = vi.hoisted(() => ({
	// biome-ignore lint/suspicious/noExplicitAny: assigned from the mock factory
	db: null as any,
	incidents: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../../db", async () => {
	const { createFakeDb, whereValues } = await import("../../test-utils/fake-db");
	fake.db = createFakeDb({
		query: {
			incidents: {
				findFirst: (args: unknown) => {
					const [incidentId, organizationId] = whereValues(args) as [string, string];
					const row = fake.incidents.get(incidentId);
					return row && row.organizationId === organizationId ? row : undefined;
				},
			},
		},
		returning: (write) => [{ incidentId: "inc-new", ...write.values }],
	});
	return { db: fake.db.db };
});

vi.mock("../notifications", () => ({ notifyEvent: async () => {} }));

import { acknowledgeIncident, listIncidents, recordIncident, resolveIncident } from "./index";

const open = (overrides: Record<string, unknown> = {}) => ({
	incidentId: "inc-1",
	organizationId: "org-1",
	kind: "uptime",
	severity: "critical",
	title: "Uptime down: api.example.test",
	metadata: { url: "https://api.example.test/" },
	acknowledgedAt: null,
	acknowledgedBy: null,
	resolvedAt: null,
	...overrides,
});

beforeEach(() => {
	fake.db.reset();
	fake.incidents = new Map([["inc-1", open()]]);
});

describe("recordIncident", () => {
	it("defaults severity to warning and every optional column to null", async () => {
		const row = await recordIncident({
			organizationId: "org-1",
			kind: "alert_rule",
			title: "cpu alert on api",
		});

		expect(fake.db.writes).toEqual([
			{
				op: "insert",
				table: "incident",
				values: {
					organizationId: "org-1",
					projectId: null,
					kind: "alert_rule",
					severity: "warning",
					title: "cpu alert on api",
					message: null,
					serviceId: null,
					serviceName: null,
					metadata: null,
				},
			},
		]);
		expect(row).toMatchObject({ incidentId: "inc-new", severity: "warning" });
	});

	it("keeps the caller's severity, project and service metadata", async () => {
		await recordIncident({
			organizationId: "org-1",
			projectId: "proj-1",
			kind: "uptime",
			severity: "critical",
			title: "down",
			message: "probe failed",
			serviceId: "app-1",
			serviceName: "api",
			metadata: { url: "https://api.example.test/" },
		});

		expect(fake.db.writes[0]?.values).toMatchObject({
			projectId: "proj-1",
			severity: "critical",
			serviceId: "app-1",
			serviceName: "api",
			metadata: { url: "https://api.example.test/" },
		});
	});
});

describe("acknowledgeIncident", () => {
	it("stamps the acknowledger but leaves the incident open", async () => {
		await acknowledgeIncident({ incidentId: "inc-1", organizationId: "org-1", userId: "user-7" });

		const write = fake.db.writes[0];
		expect(write?.op).toBe("update");
		expect(write?.values).toMatchObject({ acknowledgedBy: "user-7" });
		expect(write?.values).not.toHaveProperty("resolvedAt");
	});

	it("is idempotent: re-acknowledging keeps the first acknowledger", async () => {
		fake.incidents.set(
			"inc-1",
			open({ acknowledgedAt: new Date("2026-09-11T09:00:00Z"), acknowledgedBy: "first" }),
		);

		const row = await acknowledgeIncident({
			incidentId: "inc-1",
			organizationId: "org-1",
			userId: "second",
		});

		expect(row).toMatchObject({ acknowledgedBy: "first" });
		expect(fake.db.writes).toEqual([]);
	});

	it("refuses another organization's incident", async () => {
		await expect(
			acknowledgeIncident({ incidentId: "inc-1", organizationId: "org-2", userId: "user-7" }),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Incident not found" });
		expect(fake.db.writes).toEqual([]);
	});
});

describe("resolveIncident", () => {
	it("closes the incident and backfills the acknowledgement", async () => {
		await resolveIncident({ incidentId: "inc-1", organizationId: "org-1", userId: "user-7" });

		const values = fake.db.writes[0]?.values as Record<string, unknown>;
		expect(values.resolvedAt).toBeInstanceOf(Date);
		expect(values.acknowledgedAt).toBeInstanceOf(Date);
		expect(values.acknowledgedBy).toBe("user-7");
		expect(values.metadata).toEqual({
			url: "https://api.example.test/",
			resolvedBy: "user-7",
		});
	});

	it("keeps a resolution note in metadata, never in the public title", async () => {
		await resolveIncident({
			incidentId: "inc-1",
			organizationId: "org-1",
			userId: "user-7",
			note: "  rolled back to v1.2  ",
		});

		const values = fake.db.writes[0]?.values as Record<string, unknown>;
		expect(values.metadata).toMatchObject({
			resolutionNote: "rolled back to v1.2",
			resolvedBy: "user-7",
		});
		expect(values).not.toHaveProperty("title");
	});

	it("preserves an earlier acknowledgement and is idempotent once resolved", async () => {
		const acknowledgedAt = new Date("2026-09-11T09:00:00Z");
		fake.incidents.set("inc-1", open({ acknowledgedAt, acknowledgedBy: "first" }));

		await resolveIncident({ incidentId: "inc-1", organizationId: "org-1", userId: "second" });
		expect(fake.db.writes[0]?.values).toMatchObject({
			acknowledgedAt,
			acknowledgedBy: "first",
		});

		fake.db.reset();
		fake.incidents.set("inc-1", open({ resolvedAt: new Date("2026-09-11T09:30:00Z") }));
		await resolveIncident({ incidentId: "inc-1", organizationId: "org-1", userId: "second" });
		expect(fake.db.writes).toEqual([]);
	});
});

describe("listIncidents", () => {
	it("never reads without an organization filter", async () => {
		await expect(listIncidents("org-1")).resolves.toEqual([]);
		await expect(listIncidents("org-1", { projectId: "proj-1", limit: 5 })).resolves.toEqual([]);
	});
});
