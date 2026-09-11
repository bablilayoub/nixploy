import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-service alert rules (ops-dx #19). The three behaviours that decide
 * whether an operator gets paged, or spammed:
 *
 * - a rule only fires when the metric it watches was actually measured and is
 *   at or above its threshold;
 * - `cooldownMinutes` since `lastTriggeredAt` suppresses the repeat — and the
 *   stamp is written BEFORE the incident, so a slow notification cannot let a
 *   second pass through;
 * - a pre-loaded batch (the metrics cron hands rules in to skip a query) is
 *   re-checked against the caller's organization.
 */

const fake = vi.hoisted(() => ({
	// biome-ignore lint/suspicious/noExplicitAny: assigned from the mock factory
	db: null as any,
	/** Rows `db.select()` answers with, keyed by the selected field names. */
	selected: new Map<string, unknown[]>(),
	/** Rules `db.query.alertRules.findMany` answers with. */
	rules: [] as Array<Record<string, unknown>>,
	notifications: [] as Array<{ event: string; title: string }>,
}));

vi.mock("../../db", async () => {
	const { createFakeDb } = await import("../../test-utils/fake-db");
	fake.db = createFakeDb({
		query: {
			alertRules: { findMany: () => fake.rules },
		},
		select: (fields) =>
			fake.selected.get(
				Object.keys(fields ?? {})
					.sort()
					.join(","),
			) ?? [],
		returning: (write) => [{ incidentId: "inc-new", ...write.values }],
	});
	return { db: fake.db.db };
});

vi.mock("../notifications", () => ({
	notifyEvent: async (_org: string, event: string, payload: { title: string }) => {
		fake.notifications.push({ event, title: payload.title });
	},
}));

import {
	ALERT_RULE_METRICS,
	computeDeployFailureStreaks,
	deployStreakKey,
	evaluateServiceAlertRules,
	loadEnabledAlertRules,
	requiredAlertMetrics,
} from "./index";

const rule = (overrides: Record<string, unknown> = {}) => ({
	alertRuleId: "rule-1",
	organizationId: "org-1",
	applicationId: "app-1",
	composeId: null,
	metric: "cpu",
	threshold: 80,
	enabled: true,
	cooldownMinutes: 30,
	lastTriggeredAt: null,
	createdAt: new Date("2026-09-01T00:00:00Z"),
	...overrides,
});

const evaluate = (input: Record<string, unknown>) =>
	evaluateServiceAlertRules({
		organizationId: "org-1",
		projectId: "proj-1",
		applicationId: "app-1",
		appName: "api",
		...input,
	});

beforeEach(() => {
	fake.db.reset();
	fake.selected = new Map();
	fake.rules = [];
	fake.notifications = [];
});

describe("evaluateServiceAlertRules", () => {
	it("fires once a measured metric reaches the threshold: stamp, incident, notification", async () => {
		await evaluate({ cpu: 91.25, rules: [rule()] });

		expect(fake.db.writes.map((write: { op: string; table: string }) => write.table)).toEqual([
			"alert_rule",
			"incident",
		]);
		// The cooldown stamp lands BEFORE the incident row.
		expect(fake.db.writes[0]).toMatchObject({ op: "update", table: "alert_rule" });
		expect(fake.db.writes[1]?.values).toMatchObject({
			kind: "alert_rule",
			severity: "warning",
			title: "cpu alert on api",
			message: 'Service "api" cpu=91.3 exceeded threshold 80.',
			serviceId: "app-1",
			serviceName: "api",
			metadata: { metric: "cpu", value: 91.25, threshold: 80 },
		});
		expect(fake.notifications).toEqual([{ event: "serviceAlert", title: "cpu alert on api" }]);
	});

	it("stays quiet below the threshold and for a metric that was not measured", async () => {
		await evaluate({ cpu: 79.9, rules: [rule()] });
		await evaluate({ memoryPercent: 99, rules: [rule()] }); // cpu rule, no cpu sample
		await evaluate({ cpu: null, rules: [rule()] });

		expect(fake.db.writes).toEqual([]);
		expect(fake.notifications).toEqual([]);
	});

	it("suppresses a repeat inside the cooldown and fires again after it", async () => {
		const justNow = new Date(Date.now() - 5 * 60_000);
		await evaluate({ cpu: 95, rules: [rule({ lastTriggeredAt: justNow })] });
		expect(fake.db.writes).toEqual([]);

		const longAgo = new Date(Date.now() - 31 * 60_000);
		await evaluate({ cpu: 95, rules: [rule({ lastTriggeredAt: longAgo })] });
		expect(fake.db.writes).toHaveLength(2);
	});

	it("ignores a disabled rule or one belonging to another organization", async () => {
		await evaluate({ cpu: 95, rules: [rule({ enabled: false })] });
		await evaluate({ cpu: 95, rules: [rule({ organizationId: "org-2" })] });

		expect(fake.db.writes).toEqual([]);
	});

	it("evaluates restarts and deploy_failure_streak from their own inputs", async () => {
		await evaluate({
			restarts: 4,
			deployFailureStreak: 3,
			rules: [
				rule({ alertRuleId: "r-restarts", metric: "restarts", threshold: 3 }),
				rule({ alertRuleId: "r-streak", metric: "deploy_failure_streak", threshold: 3 }),
			],
		});

		expect(fake.notifications.map((entry) => entry.title)).toEqual([
			"restarts alert on api",
			"deploy_failure_streak alert on api",
		]);
	});

	it("does nothing for a target that is neither an application nor a compose stack", async () => {
		await evaluateServiceAlertRules({
			organizationId: "org-1",
			appName: "postgres-abc",
			cpu: 99,
			rules: [rule()],
		});

		expect(fake.db.writes).toEqual([]);
	});

	it("falls back to one org-scoped query when the caller passes no rules", async () => {
		fake.rules = [rule()];

		await evaluate({ cpu: 95 });

		expect(fake.db.writes).toHaveLength(2);
	});

	it("covers every metric the catalog advertises", () => {
		expect([...ALERT_RULE_METRICS]).toEqual(["cpu", "memory", "restarts", "deploy_failure_streak"]);
	});
});

describe("loadEnabledAlertRules / requiredAlertMetrics", () => {
	it("indexes enabled rules by service and drops rules bound to neither", async () => {
		fake.rules = [
			rule({ alertRuleId: "a" }),
			rule({ alertRuleId: "b" }),
			rule({ alertRuleId: "c", applicationId: null, composeId: "cmp-1" }),
			rule({ alertRuleId: "orphan", applicationId: null, composeId: null }),
		];

		const byService = await loadEnabledAlertRules();

		expect([...byService.keys()].sort()).toEqual(["application:app-1", "compose:cmp-1"]);
		expect(byService.get("application:app-1")).toHaveLength(2);
	});

	it("reports only metrics the catalog knows, deduplicated", async () => {
		fake.selected.set("metric", [
			{ metric: "cpu" },
			{ metric: "restarts" },
			{ metric: "not-a-metric" },
		]);

		const metrics = await requiredAlertMetrics();

		expect([...metrics].sort()).toEqual(["cpu", "restarts"]);
	});
});

describe("computeDeployFailureStreaks", () => {
	it("counts consecutive failures newest-first and stops at the first success", async () => {
		fake.selected.set(
			"applicationId,composeId,status",
			// Newest first, as the query orders them.
			[
				{ applicationId: "app-1", composeId: null, status: "error" },
				{ applicationId: "app-1", composeId: null, status: "error" },
				{ applicationId: "app-1", composeId: null, status: "done" },
				{ applicationId: "app-1", composeId: null, status: "error" },
				{ applicationId: null, composeId: "cmp-1", status: "done" },
				{ applicationId: null, composeId: "cmp-1", status: "error" },
				{ applicationId: null, composeId: null, status: "error" },
			],
		);

		const streaks = await computeDeployFailureStreaks();

		expect(streaks.get("application:app-1")).toBe(2);
		// A success closes the streak at 0 and later failures are ignored.
		expect(streaks.get("compose:cmp-1")).toBe(0);
		expect(streaks.has("null")).toBe(false);
	});

	it("ignores in-flight deployments", async () => {
		fake.selected.set("applicationId,composeId,status", [
			{ applicationId: "app-1", composeId: null, status: "running" },
			{ applicationId: "app-1", composeId: null, status: "error" },
		]);

		await expect(computeDeployFailureStreaks()).resolves.toEqual(
			new Map([["application:app-1", 1]]),
		);
	});
});

describe("deployStreakKey", () => {
	it("prefers the application id and returns null for neither", () => {
		expect(deployStreakKey({ applicationId: "app-1" })).toBe("application:app-1");
		expect(deployStreakKey({ composeId: "cmp-1" })).toBe("compose:cmp-1");
		expect(deployStreakKey({ applicationId: "app-1", composeId: "cmp-1" })).toBe(
			"application:app-1",
		);
		expect(deployStreakKey({})).toBeNull();
	});
});
