import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Uptime probes (ops-dx #19). What has to hold:
 *
 * - a probe only flips when the NEW result differs from a known previous one,
 *   and only a flip writes an incident + notification (otherwise every pass of
 *   a down service pages the org again every 30 s);
 * - the first result after `unknown` records the change time but does not flip;
 * - a probe whose host fails the egress guard is marked down without ever
 *   being fetched (it would be an SSRF probe otherwise);
 * - only probes past their own `intervalSeconds` are checked.
 */

const fake = vi.hoisted(() => ({
	// biome-ignore lint/suspicious/noExplicitAny: assigned from the mock factory
	db: null as any,
	probes: [] as Array<Record<string, unknown>>,
	/** Hosts the egress guard refuses. */
	blockedHosts: new Set<string>(),
	fetched: [] as string[],
	/** Status code the next fetch answers with; `null` throws instead. */
	responseStatus: 200 as number | null,
	notifications: [] as Array<{ event: string; title: string; message: string }>,
}));

vi.mock("../../db", async () => {
	const { createFakeDb } = await import("../../test-utils/fake-db");
	fake.db = createFakeDb({
		query: { uptimeProbes: { findMany: () => fake.probes } },
		returning: (write) => [{ incidentId: "inc-new", ...write.values }],
	});
	return { db: fake.db.db };
});

vi.mock("../../utils/public-url", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../utils/public-url")>();
	return {
		...actual,
		assertSafeOutboundUrl: async (url: string) => {
			const parsed = new URL(url);
			if (fake.blockedHosts.has(parsed.hostname)) {
				throw new Error("blocked");
			}
			return { url: parsed, addresses: ["203.0.113.10"], isPrivate: false };
		},
		pinnedFetch: async (target: { url: URL }) => {
			fake.fetched.push(target.url.toString());
			if (fake.responseStatus === null) throw new Error("ECONNREFUSED");
			return {
				ok: fake.responseStatus < 400,
				status: fake.responseStatus,
				statusText: "",
				body: "",
				headers: { get: () => null },
				text: () => "",
				json: () => ({}),
			};
		},
	};
});

vi.mock("../notifications", () => ({
	notifyEvent: async (_org: string, event: string, payload: { title: string; message: string }) => {
		fake.notifications.push({ event, title: payload.title, message: payload.message });
	},
}));

import { runUptimeProbes } from "./index";

const probe = (overrides: Record<string, unknown> = {}) => ({
	uptimeProbeId: "probe-1",
	organizationId: "org-1",
	domainId: "dom-1",
	enabled: true,
	path: "/health",
	expectedStatus: 200,
	intervalSeconds: 60,
	timeoutMs: 5_000,
	status: "up",
	lastCheckedAt: null,
	lastStatusChangeAt: null,
	lastError: null,
	domain: { host: "api.example.test", https: true },
	...overrides,
});

/** Values of the single `uptime_probe` update the pass wrote. */
const probeUpdate = (index = 0): Record<string, unknown> =>
	fake.db.writes.filter((write: { table: string }) => write.table === "uptime_probe")[index]
		?.values as Record<string, unknown>;

const incidentWrites = () =>
	fake.db.writes.filter((write: { table: string }) => write.table === "incident");

beforeEach(() => {
	fake.db.reset();
	fake.probes = [];
	fake.blockedHosts = new Set();
	fake.fetched = [];
	fake.responseStatus = 200;
	fake.notifications = [];
});

describe("runUptimeProbes", () => {
	it("checks the configured path over the domain's scheme", async () => {
		fake.probes = [probe()];

		await runUptimeProbes();

		expect(fake.fetched).toEqual(["https://api.example.test/health"]);
		expect(probeUpdate()).toMatchObject({ status: "up", lastError: null });
	});

	it("prefixes a path that does not start with a slash, and uses http for plain domains", async () => {
		fake.probes = [probe({ path: "healthz", domain: { host: "api.example.test", https: false } })];

		await runUptimeProbes();

		expect(fake.fetched).toEqual(["http://api.example.test/healthz"]);
	});

	it("stays quiet while the status does not change", async () => {
		fake.probes = [probe({ status: "up" })];

		await runUptimeProbes();

		expect(incidentWrites()).toEqual([]);
		expect(fake.notifications).toEqual([]);
		// No flip: the change timestamp is left alone.
		expect(probeUpdate()).not.toHaveProperty("lastStatusChangeAt");
	});

	it("records the change time on the first result after `unknown`, without paging", async () => {
		fake.probes = [probe({ status: "unknown" })];

		await runUptimeProbes();

		expect(probeUpdate().lastStatusChangeAt).toBeInstanceOf(Date);
		expect(incidentWrites()).toEqual([]);
		expect(fake.notifications).toEqual([]);
	});

	it("opens a critical incident and notifies when an up probe goes down", async () => {
		fake.probes = [probe({ status: "up" })];
		fake.responseStatus = 503;

		await runUptimeProbes();

		expect(probeUpdate()).toMatchObject({
			status: "down",
			lastError: "HTTP 503 (expected 200)",
		});
		expect(incidentWrites()[0]?.values).toMatchObject({
			organizationId: "org-1",
			kind: "uptime",
			severity: "critical",
			title: "Uptime down: api.example.test",
			serviceName: "api.example.test",
			metadata: { url: "https://api.example.test/health", status: "down" },
		});
		expect(fake.notifications).toEqual([
			{
				event: "uptimeFlip",
				title: "Uptime down: api.example.test",
				message: "Probe for https://api.example.test/health is down: HTTP 503 (expected 200)",
			},
		]);
	});

	it("records the transport error when the request itself fails", async () => {
		fake.probes = [probe({ status: "up" })];
		fake.responseStatus = null;

		await runUptimeProbes();

		expect(probeUpdate()).toMatchObject({ status: "down", lastError: "ECONNREFUSED" });
	});

	it("closes the loop with an info incident when a down probe recovers", async () => {
		fake.probes = [probe({ status: "down" })];

		await runUptimeProbes();

		expect(incidentWrites()[0]?.values).toMatchObject({
			severity: "info",
			title: "Uptime up: api.example.test",
			metadata: { status: "up" },
		});
		expect(fake.notifications[0]?.message).toBe(
			"Probe for https://api.example.test/health recovered.",
		);
	});

	it("marks a probe whose host the egress guard refuses down, without fetching it", async () => {
		fake.blockedHosts.add("metadata.internal");
		fake.probes = [probe({ domain: { host: "metadata.internal", https: true } })];

		await runUptimeProbes();

		expect(fake.fetched).toEqual([]);
		expect(probeUpdate()).toMatchObject({
			status: "down",
			lastError: "Probe host is not allowed (private/link-local/metadata)",
		});
		// A blocked host is a configuration problem, not an outage to page for.
		expect(incidentWrites()).toEqual([]);
	});

	it("skips a probe that is not due yet", async () => {
		fake.probes = [
			probe({ uptimeProbeId: "fresh", lastCheckedAt: new Date(Date.now() - 5_000) }),
			probe({ uptimeProbeId: "stale", lastCheckedAt: new Date(Date.now() - 120_000) }),
		];

		await runUptimeProbes();

		expect(fake.fetched).toHaveLength(1);
	});

	it("ignores a probe whose domain row is gone", async () => {
		fake.probes = [probe({ domain: null })];

		await runUptimeProbes();

		expect(fake.fetched).toEqual([]);
		expect(fake.db.writes).toEqual([]);
	});
});
