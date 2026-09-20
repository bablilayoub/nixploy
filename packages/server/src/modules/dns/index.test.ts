import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
	row: {
		provider: "cloudflare" as string | null,
		credentials: { CF_DNS_API_TOKEN: "t" } as Record<string, string> | null,
		autoRecords: true,
	},
}));

vi.mock("../../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				limit: async () => [settings.row],
			}),
		}),
	},
}));

const publicIp = vi.hoisted(() => ({ value: "203.0.113.10" as string | null }));
vi.mock("../cluster/public-host", () => ({
	detectPublicIp: async () => publicIp.value,
}));

const fake = vi.hoisted(() => ({
	zones: [
		{ id: "z1", name: "example.com" },
		{ id: "z2", name: "eu.example.com" },
	],
	records: {} as Record<string, Array<{ id: string; name: string; type: string; content: string }>>,
	calls: [] as string[],
	failListZones: false,
	failWrites: false,
	supported: true,
}));

vi.mock("./providers", () => ({
	dnsRecordsSupported: () => fake.supported,
	createDnsProviderClient: (code: string) => ({
		code,
		label: "Fake DNS",
		listZones: async () => {
			fake.calls.push("listZones");
			if (fake.failListZones) throw new Error("Fake DNS answered 401: bad token");
			return fake.zones;
		},
		listRecords: async (zone: { name: string }, name: string) => {
			fake.calls.push(`listRecords ${zone.name} ${name}`);
			return fake.records[`${zone.name}/${name}`] ?? [];
		},
		createRecord: async (zone: { name: string }, record: { name: string; content: string }) => {
			fake.calls.push(`create ${zone.name} ${record.name} ${record.content}`);
			if (fake.failWrites) throw new Error("Fake DNS answered 403: forbidden");
		},
		updateRecord: async (
			zone: { name: string },
			existing: { id: string },
			record: { name: string; content: string },
		) => {
			fake.calls.push(`update ${zone.name} ${existing.id} ${record.name} ${record.content}`);
		},
	}),
}));

import { ensureDnsRecord, ensureDnsRecords, listLinkedDnsZones } from "./index";

beforeEach(() => {
	settings.row = {
		provider: "cloudflare",
		credentials: { CF_DNS_API_TOKEN: "t" },
		autoRecords: true,
	};
	publicIp.value = "203.0.113.10";
	fake.records = {};
	fake.calls = [];
	fake.failListZones = false;
	fake.failWrites = false;
	fake.supported = true;
	delete process.env.NIXPLOY_PUBLIC_HOST;
});

describe("ensureDnsRecords", () => {
	it("creates the record in the longest matching zone with the relative name", async () => {
		const [outcome] = await ensureDnsRecords(["app.eu.example.com"]);
		expect(outcome).toMatchObject({
			status: "created",
			zone: "eu.example.com",
			name: "app.eu.example.com",
			ip: "203.0.113.10",
			provider: "Fake DNS",
		});
		expect(fake.calls).toEqual([
			"listZones",
			"listRecords eu.example.com app",
			"create eu.example.com app 203.0.113.10",
		]);
	});

	it("names the apex @ and a wildcard *", async () => {
		await ensureDnsRecords(["example.com", "*.example.com"]);
		expect(fake.calls).toContain("create example.com @ 203.0.113.10");
		expect(fake.calls).toContain("create example.com * 203.0.113.10");
	});

	it("leaves a record that already points here alone", async () => {
		fake.records["example.com/app"] = [
			{ id: "r1", name: "app", type: "A", content: "203.0.113.10" },
		];
		const [outcome] = await ensureDnsRecords(["app.example.com"]);
		expect(outcome?.status).toBe("unchanged");
		expect(fake.calls.some((call) => call.startsWith("create") || call.startsWith("update"))).toBe(
			false,
		);
	});

	it("updates a single record that points elsewhere", async () => {
		fake.records["example.com/app"] = [
			{ id: "r1", name: "app", type: "A", content: "198.51.100.7" },
		];
		const [outcome] = await ensureDnsRecords(["app.example.com"]);
		expect(outcome?.status).toBe("updated");
		expect(outcome?.message).toContain("was 198.51.100.7");
		expect(fake.calls).toContain("update example.com r1 app 203.0.113.10");
	});

	it("never clobbers a round-robin set", async () => {
		fake.records["example.com/app"] = [
			{ id: "r1", name: "app", type: "A", content: "198.51.100.7" },
			{ id: "r2", name: "app", type: "A", content: "198.51.100.8" },
		];
		const [outcome] = await ensureDnsRecords(["app.example.com"]);
		expect(outcome).toMatchObject({ status: "skipped", reason: "multiple-records" });
	});

	it("asks the provider for its zones once per batch", async () => {
		await ensureDnsRecords(["a.example.com", "b.example.com", "a.example.com"]);
		expect(fake.calls.filter((call) => call === "listZones")).toHaveLength(1);
		expect(fake.calls.filter((call) => call.startsWith("create"))).toHaveLength(2);
	});

	it("skips a host no zone contains, and keeps going for the others", async () => {
		const outcomes = await ensureDnsRecords(["app.other.dev", "app.example.com"]);
		expect(outcomes.map((outcome) => outcome.status)).toEqual(["skipped", "created"]);
		expect(outcomes[0]?.reason).toBe("no-zone");
	});

	it("skips magic-DNS hosts without touching the provider", async () => {
		const outcomes = await ensureDnsRecords(["demo-abc.traefik.me", "10-0-0-1.sslip.io"]);
		expect(outcomes.every((outcome) => outcome.reason === "host-not-eligible")).toBe(true);
		expect(fake.calls).toEqual([]);
	});

	it("is a no-op while the switch is off, unless the call is explicit", async () => {
		settings.row.autoRecords = false;
		expect((await ensureDnsRecord("app.example.com")).reason).toBe("disabled");
		expect(fake.calls).toEqual([]);
		const explicit = await ensureDnsRecord("app.example.com", { explicit: true });
		expect(explicit.status).toBe("created");
	});

	it("explains a missing or unsupported provider", async () => {
		settings.row.provider = null;
		expect((await ensureDnsRecord("app.example.com", { explicit: true })).reason).toBe(
			"no-provider",
		);
		settings.row.provider = "route53";
		fake.supported = false;
		expect((await ensureDnsRecord("app.example.com", { explicit: true })).reason).toBe(
			"provider-unsupported",
		);
	});

	it("prefers an explicit IPv4 in NIXPLOY_PUBLIC_HOST and skips without any address", async () => {
		process.env.NIXPLOY_PUBLIC_HOST = "192.0.2.44";
		expect((await ensureDnsRecord("app.example.com")).ip).toBe("192.0.2.44");
		process.env.NIXPLOY_PUBLIC_HOST = "panel.example.com";
		publicIp.value = null;
		expect((await ensureDnsRecord("app.example.com")).reason).toBe("no-public-ip");
	});

	it("reports provider failures as outcomes, never throws", async () => {
		fake.failListZones = true;
		const [outcome] = await ensureDnsRecords(["app.example.com"]);
		expect(outcome).toMatchObject({ status: "failed" });
		expect(outcome?.message).toContain("401");
		fake.failListZones = false;
		fake.failWrites = true;
		const [write] = await ensureDnsRecords(["app.example.com"]);
		expect(write).toMatchObject({ status: "failed", provider: "Fake DNS" });
		expect(write?.message).toContain("403");
	});
});

describe("listLinkedDnsZones", () => {
	it("returns the sorted zone names", async () => {
		await expect(listLinkedDnsZones()).resolves.toEqual({
			provider: "Fake DNS",
			zones: ["eu.example.com", "example.com"],
		});
	});
	it("throws a precondition error without a provider or when the provider rejects", async () => {
		settings.row.provider = null;
		await expect(listLinkedDnsZones()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		settings.row.provider = "cloudflare";
		fake.failListZones = true;
		await expect(listLinkedDnsZones()).rejects.toThrow(/401/);
	});
});
