import { beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

const outbound = vi.hoisted(() => ({
	calls: [] as Call[],
	/** Scripted answers, matched in order; `[status, body]`. */
	answers: [] as Array<[number, unknown]>,
}));

vi.mock("../../utils/public-url", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../utils/public-url")>();
	return {
		...actual,
		assertPublicHttpsUrl: async (url: string) => ({
			url: new URL(url),
			addresses: ["203.0.113.10"],
			isPrivate: false,
		}),
		pinnedFetch: async (
			target: { url: URL },
			init: { method?: string; headers?: Record<string, string>; body?: string },
		) => {
			outbound.calls.push({
				url: target.url.toString(),
				method: init.method ?? "GET",
				headers: init.headers ?? {},
				body: init.body === undefined ? undefined : JSON.parse(init.body),
			});
			const next = outbound.answers.shift() ?? [200, {}];
			const [status, payload] = next;
			const text = payload === null ? "" : JSON.stringify(payload);
			return {
				ok: status >= 200 && status < 300,
				status,
				statusText: "",
				body: text,
				headers: { get: () => null },
				text: () => text,
				json: () => JSON.parse(text),
			};
		},
	};
});

import { DnsProviderError } from "./client";
import { createDnsProviderClient, dnsRecordsSupported } from "./providers";

const spec = { name: "app", type: "A" as const, content: "203.0.113.10", ttl: 300 };

beforeEach(() => {
	outbound.calls = [];
	outbound.answers = [];
});

describe("provider table", () => {
	it("knows which DNS-01 providers have a record client", () => {
		for (const code of ["cloudflare", "digitalocean", "hetzner", "vultr", "gandiv5"]) {
			expect(dnsRecordsSupported(code)).toBe(true);
		}
		for (const code of ["route53", "namecheap", "ovh", "", "constructor"]) {
			expect(dnsRecordsSupported(code)).toBe(false);
		}
		expect(createDnsProviderClient("route53", { AWS_ACCESS_KEY_ID: "x" })).toBeNull();
	});
	it("answers null without the token the provider needs", () => {
		expect(createDnsProviderClient("cloudflare", {})).toBeNull();
		expect(createDnsProviderClient("cloudflare", { CF_DNS_API_TOKEN: "  " })).toBeNull();
		expect(createDnsProviderClient("hetzner", { HETZNER_API_KEY: "legacy" })).toBeNull();
	});
});

describe("cloudflare", () => {
	const client = () => {
		const made = createDnsProviderClient("cloudflare", { CF_DNS_API_TOKEN: "cf-token" });
		if (!made) throw new Error("no client");
		return made;
	};

	it("pages through zones with a bearer token", async () => {
		outbound.answers.push(
			[
				200,
				{
					success: true,
					result: [{ id: "z1", name: "example.com" }],
					result_info: { page: 1, total_pages: 2 },
				},
			],
			[
				200,
				{
					success: true,
					result: [{ id: "z2", name: "other.dev" }],
					result_info: { page: 2, total_pages: 2 },
				},
			],
		);
		const zones = await client().listZones();
		expect(zones).toEqual([
			{ id: "z1", name: "example.com" },
			{ id: "z2", name: "other.dev" },
		]);
		expect(outbound.calls.map((call) => call.url)).toEqual([
			"https://api.cloudflare.com/client/v4/zones?status=active&per_page=50&page=1",
			"https://api.cloudflare.com/client/v4/zones?status=active&per_page=50&page=2",
		]);
		expect(outbound.calls[0]?.headers.authorization).toBe("Bearer cf-token");
	});

	it("uses the zone token for zone reads when the operator split them", async () => {
		const made = createDnsProviderClient("cloudflare", {
			CF_DNS_API_TOKEN: "dns",
			CF_ZONE_API_TOKEN: "zone",
		});
		outbound.answers.push([200, { success: true, result: [] }]);
		await made?.listZones();
		expect(outbound.calls[0]?.headers.authorization).toBe("Bearer zone");
	});

	it("lists A records by FQDN and reports them relative to the zone", async () => {
		outbound.answers.push([
			200,
			{
				success: true,
				result: [
					{ id: "r1", type: "A", name: "app.example.com", content: "198.51.100.7" },
					{ id: "r2", type: "AAAA", name: "app.example.com", content: "2001:db8::1" },
				],
			},
		]);
		const records = await client().listRecords({ id: "z1", name: "example.com" }, "app");
		expect(records).toEqual([{ id: "r1", name: "app", type: "A", content: "198.51.100.7" }]);
		expect(outbound.calls[0]?.url).toBe(
			"https://api.cloudflare.com/client/v4/zones/z1/dns_records?type=A&name=app.example.com&per_page=100",
		);
	});

	it("creates an unproxied FQDN record and patches content on update", async () => {
		outbound.answers.push([200, { success: true, result: { id: "r1" } }], [200, { success: true }]);
		const zone = { id: "z1", name: "example.com" };
		await client().createRecord(zone, { ...spec, name: "*" });
		await client().updateRecord(zone, { id: "r1", name: "app", type: "A", content: "x" }, spec);
		expect(outbound.calls[0]).toMatchObject({
			method: "POST",
			url: "https://api.cloudflare.com/client/v4/zones/z1/dns_records",
			body: { type: "A", name: "*.example.com", content: "203.0.113.10", ttl: 300, proxied: false },
		});
		expect(outbound.calls[1]).toMatchObject({
			method: "PATCH",
			url: "https://api.cloudflare.com/client/v4/zones/z1/dns_records/r1",
			body: { content: "203.0.113.10", ttl: 300 },
		});
	});

	it("surfaces the provider's message on an error status", async () => {
		outbound.answers.push([
			403,
			{ success: false, errors: [{ code: 10000, message: "Authentication error" }] },
		]);
		await expect(client().listZones()).rejects.toThrow(DnsProviderError);
		outbound.answers.push([
			403,
			{ success: false, errors: [{ code: 10000, message: "Authentication error" }] },
		]);
		await expect(client().listZones()).rejects.toThrow(
			"Cloudflare answered 403: Authentication error",
		);
	});
});

describe("digitalocean", () => {
	const client = () => {
		const made = createDnsProviderClient("digitalocean", { DO_AUTH_TOKEN: "do-token" });
		if (!made) throw new Error("no client");
		return made;
	};
	it("lists domains as zones and follows the next link", async () => {
		outbound.answers.push(
			[
				200,
				{
					domains: [{ name: "example.com" }],
					links: { pages: { next: "https://api.digitalocean.com/v2/domains?page=2" } },
				},
			],
			[200, { domains: [{ name: "other.dev" }], links: { pages: {} } }],
		);
		const zones = await client().listZones();
		expect(zones.map((zone) => zone.name)).toEqual(["example.com", "other.dev"]);
		expect(outbound.calls[1]?.url).toBe(
			"https://api.digitalocean.com/v2/domains?per_page=200&page=2",
		);
	});
	it("filters by FQDN but writes relative names", async () => {
		outbound.answers.push(
			[200, { domain_records: [{ id: 42, type: "A", name: "@", data: "198.51.100.7" }] }],
			[201, { domain_record: { id: 43 } }],
			[200, { domain_record: { id: 42 } }],
		);
		const zone = { id: "example.com", name: "example.com" };
		const records = await client().listRecords(zone, "@");
		expect(records).toEqual([{ id: "42", name: "@", type: "A", content: "198.51.100.7" }]);
		expect(outbound.calls[0]?.url).toBe(
			"https://api.digitalocean.com/v2/domains/example.com/records?type=A&name=example.com&per_page=200",
		);
		await client().createRecord(zone, { ...spec, name: "@" });
		expect(outbound.calls[1]).toMatchObject({
			method: "POST",
			url: "https://api.digitalocean.com/v2/domains/example.com/records",
			body: { type: "A", name: "@", data: "203.0.113.10", ttl: 300 },
		});
		await client().updateRecord(zone, records[0] as never, spec);
		expect(outbound.calls[2]).toMatchObject({
			method: "PATCH",
			url: "https://api.digitalocean.com/v2/domains/example.com/records/42",
			body: { data: "203.0.113.10", ttl: 300 },
		});
	});
});

describe("hetzner (Cloud API)", () => {
	const client = () => {
		const made = createDnsProviderClient("hetzner", { HETZNER_API_TOKEN: "hz-token" });
		if (!made) throw new Error("no client");
		return made;
	};
	it("offers primary zones only", async () => {
		outbound.answers.push([
			200,
			{
				zones: [
					{ id: 1, name: "example.com", mode: "primary" },
					{ id: 2, name: "secondary.dev", mode: "secondary" },
				],
				meta: { pagination: { next_page: null } },
			},
		]);
		expect((await client().listZones()).map((zone) => zone.name)).toEqual(["example.com"]);
		expect(outbound.calls[0]?.url).toBe("https://api.hetzner.cloud/v1/zones?per_page=50&page=1");
		expect(outbound.calls[0]?.headers.authorization).toBe("Bearer hz-token");
	});
	it("reads the rrset, treats 404 as empty, creates an rrset and sets records on update", async () => {
		const zone = { id: "example.com", name: "example.com" };
		outbound.answers.push(
			[404, { error: { code: "not_found", message: "no such rrset" } }],
			[
				200,
				{
					rrset: {
						id: "app/A",
						name: "app",
						type: "A",
						ttl: 300,
						records: [{ value: "198.51.100.7" }],
					},
				},
			],
			[201, { rrset: {}, action: { id: 1, status: "running" } }],
			[201, { action: { id: 2, status: "running" } }],
		);
		expect(await client().listRecords(zone, "*")).toEqual([]);
		expect(outbound.calls[0]?.url).toBe(
			"https://api.hetzner.cloud/v1/zones/example.com/rrsets/*/A",
		);
		const records = await client().listRecords(zone, "app");
		expect(records).toEqual([{ id: "app/A", name: "app", type: "A", content: "198.51.100.7" }]);
		await client().createRecord(zone, { ...spec, name: "@" });
		expect(outbound.calls[2]).toMatchObject({
			method: "POST",
			url: "https://api.hetzner.cloud/v1/zones/example.com/rrsets",
			body: { name: "@", type: "A", ttl: 300, records: [{ value: "203.0.113.10" }] },
		});
		await client().updateRecord(zone, records[0] as never, spec);
		expect(outbound.calls[3]).toMatchObject({
			method: "POST",
			url: "https://api.hetzner.cloud/v1/zones/example.com/rrsets/app/A/actions/set_records",
			body: { records: [{ value: "203.0.113.10" }] },
		});
	});
});

describe("vultr", () => {
	const client = () => {
		const made = createDnsProviderClient("vultr", { VULTR_API_KEY: "vultr-key" });
		if (!made) throw new Error("no client");
		return made;
	};
	it("filters the unfiltered record list client-side and maps the apex to an empty name", async () => {
		const zone = { id: "example.com", name: "example.com" };
		outbound.answers.push(
			[200, { domains: [{ domain: "example.com" }], meta: { links: { next: "" } } }],
			[
				200,
				{
					records: [
						{ id: "a", type: "A", name: "", data: "198.51.100.7" },
						{ id: "b", type: "A", name: "www", data: "198.51.100.8" },
						{ id: "c", type: "TXT", name: "", data: "v=spf1" },
					],
					meta: { links: { next: "" } },
				},
			],
			[201, { record: { id: "d" } }],
			[204, null],
		);
		expect((await client().listZones()).map((zone) => zone.name)).toEqual(["example.com"]);
		const records = await client().listRecords(zone, "@");
		expect(records).toEqual([{ id: "a", name: "@", type: "A", content: "198.51.100.7" }]);
		await client().createRecord(zone, { ...spec, name: "@" });
		expect(outbound.calls[2]).toMatchObject({
			method: "POST",
			url: "https://api.vultr.com/v2/domains/example.com/records",
			body: { name: "", type: "A", data: "203.0.113.10", ttl: 300 },
		});
		await client().updateRecord(zone, records[0] as never, spec);
		expect(outbound.calls[3]).toMatchObject({
			method: "PATCH",
			url: "https://api.vultr.com/v2/domains/example.com/records/a",
			body: { data: "203.0.113.10", ttl: 300 },
		});
		expect(outbound.calls[0]?.headers.authorization).toBe("Bearer vultr-key");
	});
});

describe("gandi livedns", () => {
	const client = () => {
		const made = createDnsProviderClient("gandiv5", { GANDIV5_PERSONAL_ACCESS_TOKEN: "pat" });
		if (!made) throw new Error("no client");
		return made;
	};
	it("lists domains, reads an rrset (404 → none) and PUTs for both create and update", async () => {
		const zone = { id: "example.com", name: "example.com" };
		outbound.answers.push(
			[200, [{ fqdn: "example.com" }]],
			[404, { message: "Not found" }],
			[200, { rrset_name: "app", rrset_type: "A", rrset_ttl: 300, rrset_values: ["198.51.100.7"] }],
			[201, { message: "DNS Record Created" }],
			[201, { message: "DNS Record Created" }],
		);
		expect((await client().listZones()).map((zone) => zone.name)).toEqual(["example.com"]);
		expect(outbound.calls[0]?.url).toBe(
			"https://api.gandi.net/v5/livedns/domains?per_page=100&page=1",
		);
		expect(await client().listRecords(zone, "@")).toEqual([]);
		expect(outbound.calls[1]?.url).toBe(
			"https://api.gandi.net/v5/livedns/domains/example.com/records/%40/A",
		);
		const records = await client().listRecords(zone, "app");
		expect(records).toEqual([{ id: "app/A", name: "app", type: "A", content: "198.51.100.7" }]);
		await client().createRecord(zone, spec);
		await client().updateRecord(zone, records[0] as never, spec);
		for (const call of outbound.calls.slice(3)) {
			expect(call).toMatchObject({
				method: "PUT",
				url: "https://api.gandi.net/v5/livedns/domains/example.com/records/app/A",
				body: { rrset_values: ["203.0.113.10"], rrset_ttl: 300 },
			});
		}
		expect(outbound.calls[3]?.headers.authorization).toBe("Bearer pat");
	});
});
