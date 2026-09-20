import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { detectPublicIp } from "../cluster/public-host";
import { badRequest, preconditionFailed } from "../errors";
import type { DnsProviderClient, DnsRecordSpec } from "./client";
import { DnsProviderError } from "./client";
import { createDnsProviderClient, dnsRecordsSupported } from "./providers";
import {
	type DnsZone,
	findZoneForHost,
	fqdnOf,
	isAutomatableHost,
	relativeRecordName,
} from "./zones";

export { dnsRecordsSupported } from "./providers";

const log = createLogger("dns");

/** Short TTL so a moved host follows quickly; every provider accepts 300. */
const RECORD_TTL_SECONDS = 300;

export type DnsRecordStatus = "created" | "updated" | "unchanged" | "skipped" | "failed";

export type DnsSkipReason =
	/** `dnsAutoRecords` is off and the call was not an explicit request. */
	| "disabled"
	/** No DNS provider is linked (Settings → Wildcard certificates). */
	| "no-provider"
	/** The linked provider is offered for DNS-01 but has no record client here. */
	| "provider-unsupported"
	/** IP literal, bare name, magic DNS (`*.traefik.me`) — nothing to write. */
	| "host-not-eligible"
	/** The host's public IPv4 could not be determined. */
	| "no-public-ip"
	/** No zone at the provider contains the host. */
	| "no-zone"
	/** The name already has several A records (round-robin); left alone. */
	| "multiple-records";

/**
 * What happened to one host. `message` is human-readable and safe to show a
 * tenant: it never carries the provider credential, and a provider failure is
 * summarized to its status and message.
 */
export interface DnsRecordOutcome {
	host: string;
	status: DnsRecordStatus;
	reason?: DnsSkipReason;
	message: string;
	provider?: string;
	zone?: string;
	/** The record's FQDN as the provider holds it. */
	name?: string;
	ip?: string;
}

interface DnsContext {
	client: DnsProviderClient;
	ip: string;
	zones: DnsZone[];
}

interface DnsSettings {
	provider: string | null;
	credentials: Record<string, string> | null;
	autoRecords: boolean;
}

async function readSettings(): Promise<DnsSettings> {
	const [row] = await db
		.select({
			provider: webServerSettings.acmeDnsProvider,
			credentials: webServerSettings.acmeDnsCredentials,
			autoRecords: webServerSettings.dnsAutoRecords,
		})
		.from(webServerSettings)
		.limit(1);
	const credentials =
		row?.credentials && typeof row.credentials === "object"
			? (row.credentials as Record<string, string>)
			: null;
	return {
		provider: row?.provider ?? null,
		credentials,
		autoRecords: row?.autoRecords ?? false,
	};
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The address records should point at: `NIXPLOY_PUBLIC_HOST` when it is an
 * IPv4 literal (a NAT'd box where detection would answer the gateway), else
 * the detected public IPv4. A hostname in `NIXPLOY_PUBLIC_HOST` is not an A
 * record target, so it falls through to detection.
 */
async function resolvePublicIpv4(): Promise<string | null> {
	const explicit = process.env.NIXPLOY_PUBLIC_HOST?.trim();
	if (explicit && IPV4.test(explicit)) return explicit;
	return detectPublicIp();
}

/** Build a client from the linked provider, or explain why there is none. */
function clientFromSettings(settings: DnsSettings): DnsProviderClient | DnsSkipReason {
	if (!settings.provider) return "no-provider";
	if (!dnsRecordsSupported(settings.provider)) return "provider-unsupported";
	const client = createDnsProviderClient(settings.provider, settings.credentials ?? {});
	return client ?? "provider-unsupported";
}

const SKIP_MESSAGES: Record<DnsSkipReason, string> = {
	disabled: "Automatic DNS records are off (Settings → Wildcard certificates)",
	"no-provider": "No DNS provider is linked (Settings → Wildcard certificates)",
	"provider-unsupported": "The linked DNS provider has no record automation in this version",
	"host-not-eligible": "This host is not one a DNS provider can hold a record for",
	"no-public-ip": "The server's public IPv4 address could not be determined",
	"no-zone": "No zone at the linked provider contains this host",
	"multiple-records": "The name already has several A records; left unchanged",
};

function skipped(host: string, reason: DnsSkipReason, extra: Partial<DnsRecordOutcome> = {}) {
	return { host, status: "skipped" as const, reason, message: SKIP_MESSAGES[reason], ...extra };
}

/**
 * Point `host` at this box in the provider's zone: create the A record, or
 * update a single existing one whose address differs. Pure over the client
 * so the provider tests and this one never need the network.
 */
export async function ensureRecordWithClient(
	context: DnsContext,
	host: string,
): Promise<DnsRecordOutcome> {
	const { client, ip, zones } = context;
	const base = { provider: client.label, ip };
	if (!isAutomatableHost(host)) return skipped(host, "host-not-eligible", base);
	const zone = findZoneForHost(host, zones);
	if (!zone) return skipped(host, "no-zone", base);
	const name = relativeRecordName(host, zone.name);
	const fqdn = fqdnOf(zone.name, name);
	const where = { ...base, zone: zone.name, name: fqdn };
	const spec: DnsRecordSpec = { name, type: "A", content: ip, ttl: RECORD_TTL_SECONDS };

	const existing = await client.listRecords(zone, name);
	if (existing.some((record) => record.content === ip)) {
		return { host, status: "unchanged", message: `${fqdn} already points at ${ip}`, ...where };
	}
	if (existing.length > 1) return skipped(host, "multiple-records", where);
	const [current] = existing;
	if (current) {
		await client.updateRecord(zone, current, spec);
		return {
			host,
			status: "updated",
			message: `${fqdn} now points at ${ip} (was ${current.content}) at ${client.label}`,
			...where,
		};
	}
	await client.createRecord(zone, spec);
	return {
		host,
		status: "created",
		message: `${fqdn} → ${ip} created at ${client.label}`,
		...where,
	};
}

/**
 * Resolve everything the loop needs once — settings, client, public IP, the
 * zone list — or the reason nothing can be done. Returns a skip reason so a
 * template deploy with five hosts does not ask the provider for its zones
 * five times.
 */
async function buildContext(options: { explicit: boolean }): Promise<DnsContext | DnsSkipReason> {
	const settings = await readSettings();
	if (!options.explicit && !settings.autoRecords) return "disabled";
	const client = clientFromSettings(settings);
	if (typeof client === "string") return client;
	const ip = await resolvePublicIpv4();
	if (!ip) return "no-public-ip";
	const zones = await client.listZones();
	return { client, ip, zones };
}

/**
 * Create or fix the A record for each host at the linked provider. Never
 * throws: a provider outage must not fail the domain that was just
 * attached, so every failure comes back as an outcome. `explicit` bypasses
 * the `dnsAutoRecords` switch (a button in the panel or the CLI verb), not
 * the provider requirement.
 */
export async function ensureDnsRecords(
	hosts: readonly string[],
	options: { explicit?: boolean } = {},
): Promise<DnsRecordOutcome[]> {
	const unique = [...new Set(hosts.map((host) => host.trim()).filter(Boolean))];
	if (unique.length === 0) return [];
	// The cheap "nothing to do" paths: no provider call before eligibility.
	if (!unique.some(isAutomatableHost) && !options.explicit) {
		return unique.map((host) => skipped(host, "host-not-eligible"));
	}
	let context: DnsContext | DnsSkipReason;
	try {
		context = await buildContext({ explicit: options.explicit ?? false });
	} catch (error) {
		const message = describeFailure(error);
		log.warn("DNS provider unavailable", { error: message });
		return unique.map((host) => ({ host, status: "failed" as const, message }));
	}
	if (typeof context === "string") {
		const reason = context;
		return unique.map((host) => skipped(host, reason));
	}
	const outcomes: DnsRecordOutcome[] = [];
	for (const host of unique) {
		try {
			const outcome = await ensureRecordWithClient(context, host);
			if (outcome.status === "created" || outcome.status === "updated") {
				log.info(`DNS record ${outcome.status}`, {
					host,
					provider: context.client.code,
					zone: outcome.zone,
					ip: context.ip,
				});
			}
			outcomes.push(outcome);
		} catch (error) {
			const message = describeFailure(error);
			log.warn("DNS record write failed", { host, provider: context.client.code, error: message });
			outcomes.push({
				host,
				status: "failed",
				message,
				provider: context.client.label,
				ip: context.ip,
			});
		}
	}
	return outcomes;
}

/** One host; same contract as {@link ensureDnsRecords}. */
export async function ensureDnsRecord(
	host: string,
	options: { explicit?: boolean } = {},
): Promise<DnsRecordOutcome> {
	const [outcome] = await ensureDnsRecords([host], options);
	return outcome ?? { host, status: "skipped", reason: "host-not-eligible", message: "" };
}

function describeFailure(error: unknown): string {
	if (error instanceof DnsProviderError) return error.message;
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * The zones the linked provider shows for the stored credentials — the
 * settings card's "check the link" answer. Throws, unlike the ensure path:
 * this is an explicit instance-admin action and the error is the point.
 */
export async function listLinkedDnsZones(): Promise<{ provider: string; zones: string[] }> {
	const settings = await readSettings();
	const client = clientFromSettings(settings);
	if (client === "no-provider") throw preconditionFailed(SKIP_MESSAGES["no-provider"]);
	if (typeof client === "string") throw badRequest(SKIP_MESSAGES[client]);
	try {
		const zones = await client.listZones();
		return { provider: client.label, zones: zones.map((zone) => zone.name).sort() };
	} catch (error) {
		throw preconditionFailed(describeFailure(error));
	}
}
