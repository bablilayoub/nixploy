import { type DnsProviderClient, type DnsRecord, type DnsRecordSpec, providerJson } from "./client";
import { type DnsZone, fqdnOf, normalizeHost, relativeRecordName } from "./zones";

/**
 * One client per DNS-01 provider that also has a usable record API. Request
 * shapes were read from each provider's own reference (or its published
 * OpenAPI spec) on 2026-09-20 — see docs/domains-traefik.md § "DNS records
 * created for you" for what is deliberately not done (deletes, proxying).
 *
 * Route 53 (SigV4 signing), Namecheap (XML API, IP allow-list) and OVH
 * (request signing) are certificates-only until someone needs them.
 */

const PAGE_CAP = 10;

type Factory = (credentials: Record<string, string>) => DnsProviderClient | null;

const token = (credentials: Record<string, string>, key: string): string | null => {
	const value = credentials[key]?.trim();
	return value ? value : null;
};

const bearer = (value: string): Record<string, string> => ({ authorization: `Bearer ${value}` });

const zoneOf = (name: string): DnsZone => ({ id: normalizeHost(name), name: normalizeHost(name) });

/* ------------------------------------------------------------------ Cloudflare */

interface CfEnvelope<T> {
	success: boolean;
	result: T;
	result_info?: { page: number; total_pages: number };
}
interface CfZone {
	id: string;
	name: string;
}
interface CfRecord {
	id: string;
	type: string;
	name: string;
	content: string;
}

/**
 * Cloudflare: record names are FQDNs; `proxied: false` on purpose (a
 * proxied A record hides the server from the route diagnostician and breaks
 * the DNS-only wildcards tunnel templates need). An operator who split
 * tokens (`CF_ZONE_API_TOKEN` for Zone:Read) gets it used for zone reads.
 */
const cloudflare: Factory = (credentials) => {
	const dnsToken = token(credentials, "CF_DNS_API_TOKEN");
	if (!dnsToken) return null;
	const zoneToken = token(credentials, "CF_ZONE_API_TOKEN") ?? dnsToken;
	const base = "https://api.cloudflare.com/client/v4";
	const label = "Cloudflare";
	return {
		code: "cloudflare",
		label,
		async listZones() {
			const zones: DnsZone[] = [];
			for (let page = 1; page <= PAGE_CAP; page += 1) {
				const body = await providerJson<CfEnvelope<CfZone[]>>(
					label,
					`${base}/zones?status=active&per_page=50&page=${page}`,
					{ headers: bearer(zoneToken) },
				);
				for (const zone of body?.result ?? []) zones.push({ id: zone.id, name: zone.name });
				if (!body?.result_info || page >= body.result_info.total_pages) break;
			}
			return zones;
		},
		async listRecords(zone, name) {
			const fqdn = fqdnOf(zone.name, name);
			const body = await providerJson<CfEnvelope<CfRecord[]>>(
				label,
				`${base}/zones/${encodeURIComponent(zone.id)}/dns_records?type=A&name=${encodeURIComponent(fqdn)}&per_page=100`,
				{ headers: bearer(dnsToken) },
			);
			return (body?.result ?? [])
				.filter((record) => record.type === "A")
				.map((record) => ({
					id: record.id,
					name: relativeRecordName(record.name, zone.name),
					type: record.type,
					content: record.content,
				}));
		},
		async createRecord(zone, record) {
			await providerJson(label, `${base}/zones/${encodeURIComponent(zone.id)}/dns_records`, {
				method: "POST",
				headers: bearer(dnsToken),
				body: {
					type: "A",
					name: fqdnOf(zone.name, record.name),
					content: record.content,
					ttl: record.ttl,
					proxied: false,
					comment: "Created by Nixploy",
				},
			});
		},
		async updateRecord(zone, existing, record) {
			await providerJson(
				label,
				`${base}/zones/${encodeURIComponent(zone.id)}/dns_records/${encodeURIComponent(existing.id)}`,
				{
					method: "PATCH",
					headers: bearer(dnsToken),
					body: { content: record.content, ttl: record.ttl },
				},
			);
		},
	};
};

/* ---------------------------------------------------------------- DigitalOcean */

interface DoDomains {
	domains: Array<{ name: string }>;
	links?: { pages?: { next?: string } };
}
interface DoRecords {
	domain_records: Array<{ id: number; type: string; name: string; data: string }>;
}

/** DigitalOcean: zones are named by their apex; record names are relative (`@` apex). */
const digitalocean: Factory = (credentials) => {
	const auth = token(credentials, "DO_AUTH_TOKEN");
	if (!auth) return null;
	const base = "https://api.digitalocean.com/v2";
	const label = "DigitalOcean";
	return {
		code: "digitalocean",
		label,
		async listZones() {
			const zones: DnsZone[] = [];
			for (let page = 1; page <= PAGE_CAP; page += 1) {
				const body = await providerJson<DoDomains>(
					label,
					`${base}/domains?per_page=200&page=${page}`,
					{ headers: bearer(auth) },
				);
				for (const domain of body?.domains ?? []) zones.push(zoneOf(domain.name));
				if (!body?.links?.pages?.next) break;
			}
			return zones;
		},
		async listRecords(zone, name) {
			const fqdn = fqdnOf(zone.name, name);
			const body = await providerJson<DoRecords>(
				label,
				`${base}/domains/${encodeURIComponent(zone.id)}/records?type=A&name=${encodeURIComponent(fqdn)}&per_page=200`,
				{ headers: bearer(auth) },
			);
			return (body?.domain_records ?? [])
				.filter((record) => record.type === "A")
				.map((record) => ({
					id: String(record.id),
					name: record.name,
					type: record.type,
					content: record.data,
				}));
		},
		async createRecord(zone, record) {
			await providerJson(label, `${base}/domains/${encodeURIComponent(zone.id)}/records`, {
				method: "POST",
				headers: bearer(auth),
				body: { type: "A", name: record.name, data: record.content, ttl: record.ttl },
			});
		},
		async updateRecord(zone, existing, record) {
			await providerJson(
				label,
				`${base}/domains/${encodeURIComponent(zone.id)}/records/${encodeURIComponent(existing.id)}`,
				{ method: "PATCH", headers: bearer(auth), body: { data: record.content, ttl: record.ttl } },
			);
		},
	};
};

/* --------------------------------------------------------- Hetzner (Cloud API) */

interface HetznerZones {
	zones: Array<{ id: number; name: string; mode: string }>;
	meta?: { pagination?: { next_page: number | null } };
}
interface HetznerRrset {
	rrset: {
		id: string;
		name: string;
		type: string;
		ttl: number | null;
		records: Array<{ value: string }>;
	};
}

/**
 * Hetzner DNS lives in the Cloud API now (`api.hetzner.cloud`); records are
 * RRsets addressed by relative name + type, and every write is an async
 * action the API applies within seconds — not polled here. Only `primary`
 * zones are writable, so secondaries are not offered.
 */
const hetzner: Factory = (credentials) => {
	const auth = token(credentials, "HETZNER_API_TOKEN");
	if (!auth) return null;
	const base = "https://api.hetzner.cloud/v1";
	const label = "Hetzner DNS";
	const rrsetPath = (zone: DnsZone, name: string) =>
		`${base}/zones/${encodeURIComponent(zone.id)}/rrsets/${encodeURIComponent(name)}/A`;
	return {
		code: "hetzner",
		label,
		async listZones() {
			const zones: DnsZone[] = [];
			for (let page = 1; page <= PAGE_CAP; page += 1) {
				const body = await providerJson<HetznerZones>(
					label,
					`${base}/zones?per_page=50&page=${page}`,
					{ headers: bearer(auth) },
				);
				for (const zone of body?.zones ?? []) {
					if (zone.mode === "primary") zones.push(zoneOf(zone.name));
				}
				if (!body?.meta?.pagination?.next_page) break;
			}
			return zones;
		},
		async listRecords(zone, name) {
			const body = await providerJson<HetznerRrset>(label, rrsetPath(zone, name), {
				headers: bearer(auth),
				notFound: [404],
			});
			const rrset = body?.rrset;
			if (!rrset) return [];
			return rrset.records.map((entry) => ({
				id: rrset.id,
				name: rrset.name,
				type: rrset.type,
				content: entry.value,
			}));
		},
		async createRecord(zone, record) {
			await providerJson(label, `${base}/zones/${encodeURIComponent(zone.id)}/rrsets`, {
				method: "POST",
				headers: bearer(auth),
				body: {
					name: record.name,
					type: "A",
					ttl: record.ttl,
					records: [{ value: record.content }],
				},
			});
		},
		async updateRecord(zone, _existing, record) {
			await providerJson(label, `${rrsetPath(zone, record.name)}/actions/set_records`, {
				method: "POST",
				headers: bearer(auth),
				body: { records: [{ value: record.content }] },
			});
		},
	};
};

/* ---------------------------------------------------------------------- Vultr */

interface VultrDomains {
	domains: Array<{ domain: string }>;
	meta?: { links?: { next?: string } };
}
interface VultrRecords {
	records: Array<{ id: string; type: string; name: string; data: string }>;
	meta?: { links?: { next?: string } };
}

/** Vultr: relative names with `""` for the apex; the record list has no filter. */
const vultr: Factory = (credentials) => {
	const auth = token(credentials, "VULTR_API_KEY");
	if (!auth) return null;
	const base = "https://api.vultr.com/v2";
	const label = "Vultr";
	const toVultr = (name: string) => (name === "@" ? "" : name);
	const fromVultr = (name: string) => (name === "" ? "@" : name);
	return {
		code: "vultr",
		label,
		async listZones() {
			const zones: DnsZone[] = [];
			let cursor = "";
			for (let page = 1; page <= PAGE_CAP; page += 1) {
				const body = await providerJson<VultrDomains>(
					label,
					`${base}/domains?per_page=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
					{ headers: bearer(auth) },
				);
				for (const domain of body?.domains ?? []) zones.push(zoneOf(domain.domain));
				cursor = body?.meta?.links?.next ?? "";
				if (!cursor) break;
			}
			return zones;
		},
		async listRecords(zone, name) {
			const wanted = toVultr(name);
			const records: DnsRecord[] = [];
			let cursor = "";
			for (let page = 1; page <= PAGE_CAP; page += 1) {
				const body = await providerJson<VultrRecords>(
					label,
					`${base}/domains/${encodeURIComponent(zone.id)}/records?per_page=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
					{ headers: bearer(auth) },
				);
				for (const record of body?.records ?? []) {
					if (record.type !== "A" || record.name !== wanted) continue;
					records.push({
						id: record.id,
						name: fromVultr(record.name),
						type: record.type,
						content: record.data,
					});
				}
				cursor = body?.meta?.links?.next ?? "";
				if (!cursor) break;
			}
			return records;
		},
		async createRecord(zone, record) {
			await providerJson(label, `${base}/domains/${encodeURIComponent(zone.id)}/records`, {
				method: "POST",
				headers: bearer(auth),
				body: { name: toVultr(record.name), type: "A", data: record.content, ttl: record.ttl },
			});
		},
		async updateRecord(zone, existing, record) {
			await providerJson(
				label,
				`${base}/domains/${encodeURIComponent(zone.id)}/records/${encodeURIComponent(existing.id)}`,
				{ method: "PATCH", headers: bearer(auth), body: { data: record.content, ttl: record.ttl } },
			);
		},
	};
};

/* -------------------------------------------------------------- Gandi LiveDNS */

interface GandiRrset {
	rrset_name: string;
	rrset_type: string;
	rrset_values: string[];
}

/**
 * Gandi LiveDNS: an rrset is addressed by relative name + type, and `PUT`
 * on it creates or replaces — so create and update are the same call.
 * TTL floor is 300, which is the value used everywhere here.
 */
const gandiv5: Factory = (credentials) => {
	const auth = token(credentials, "GANDIV5_PERSONAL_ACCESS_TOKEN");
	if (!auth) return null;
	const base = "https://api.gandi.net/v5/livedns";
	const label = "Gandi LiveDNS";
	const rrsetPath = (zone: DnsZone, name: string) =>
		`${base}/domains/${encodeURIComponent(zone.id)}/records/${encodeURIComponent(name)}/A`;
	const put = async (zone: DnsZone, record: DnsRecordSpec) => {
		await providerJson(label, rrsetPath(zone, record.name), {
			method: "PUT",
			headers: bearer(auth),
			body: { rrset_values: [record.content], rrset_ttl: record.ttl },
		});
	};
	return {
		code: "gandiv5",
		label,
		async listZones() {
			const zones: DnsZone[] = [];
			for (let page = 1; page <= PAGE_CAP; page += 1) {
				const body = await providerJson<Array<{ fqdn: string }>>(
					label,
					`${base}/domains?per_page=100&page=${page}`,
					{ headers: bearer(auth) },
				);
				const list = body ?? [];
				for (const domain of list) zones.push(zoneOf(domain.fqdn));
				if (list.length < 100) break;
			}
			return zones;
		},
		async listRecords(zone, name) {
			const body = await providerJson<GandiRrset>(label, rrsetPath(zone, name), {
				headers: bearer(auth),
				notFound: [404],
			});
			if (!body) return [];
			return body.rrset_values.map((value) => ({
				id: `${body.rrset_name}/A`,
				name: body.rrset_name,
				type: body.rrset_type,
				content: value,
			}));
		},
		createRecord: put,
		updateRecord: (zone, _existing, record) => put(zone, record),
	};
};

const FACTORIES: Record<string, Factory> = { cloudflare, digitalocean, hetzner, vultr, gandiv5 };

/** Does the DNS-01 provider also have record automation in this build? */
export function dnsRecordsSupported(code: string | null | undefined): boolean {
	return Boolean(code && Object.hasOwn(FACTORIES, code));
}

/**
 * A client for the provider, or null when the code has no client here or
 * the stored credentials lack the token it needs.
 */
export function createDnsProviderClient(
	code: string,
	credentials: Record<string, string>,
): DnsProviderClient | null {
	const factory = Object.hasOwn(FACTORIES, code) ? FACTORIES[code] : undefined;
	return factory ? factory(credentials) : null;
}
