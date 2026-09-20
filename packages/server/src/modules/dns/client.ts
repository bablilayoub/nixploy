import { assertPublicHttpsUrl, type PinnedFetchInit, pinnedFetch } from "../../utils/public-url";
import type { DnsZone } from "./zones";

/** One A record as a provider reports it. */
export interface DnsRecord {
	id: string;
	/** Relative to the zone (`@`, `app`, `*.apps`) — clients normalize. */
	name: string;
	type: string;
	content: string;
}

export interface DnsRecordSpec {
	/** Relative to the zone, see `zones.ts`. */
	name: string;
	type: "A";
	content: string;
	ttl: number;
}

/**
 * The four calls the record automation needs from a provider. Kept to A
 * records on purpose: the feature points hosts at this box, nothing else.
 */
export interface DnsProviderClient {
	code: string;
	label: string;
	listZones(): Promise<DnsZone[]>;
	/** A records in `zone` whose relative name is `name`. */
	listRecords(zone: DnsZone, name: string): Promise<DnsRecord[]>;
	createRecord(zone: DnsZone, record: DnsRecordSpec): Promise<void>;
	updateRecord(zone: DnsZone, existing: DnsRecord, record: DnsRecordSpec): Promise<void>;
}

/** A provider answered with an error status — surfaced as `failed`, never thrown to a tenant. */
export class DnsProviderError extends Error {
	constructor(
		readonly provider: string,
		readonly status: number,
		detail: string,
	) {
		super(detail ? `${provider} answered ${status}: ${detail}` : `${provider} answered ${status}`);
		this.name = "DnsProviderError";
	}
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_DETAIL = 200;

/**
 * JSON request to a provider API. The base URLs are constants, not tenant
 * input, but the call still goes through the pinned fetch so every outbound
 * request in the server takes the same path (timeouts, body caps, no
 * redirects, no global `fetch` on the request path).
 */
export async function providerJson<T>(
	provider: string,
	url: string,
	init: {
		method?: string;
		headers: Record<string, string>;
		body?: unknown;
		/** Statuses to treat as "no such thing" and answer `null` for. */
		notFound?: readonly number[];
	},
): Promise<T | null> {
	const target = await assertPublicHttpsUrl(url);
	const request: PinnedFetchInit = {
		method: init.method ?? "GET",
		headers: {
			accept: "application/json",
			...(init.body !== undefined ? { "content-type": "application/json" } : {}),
			...init.headers,
		},
		...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
		timeoutMs: REQUEST_TIMEOUT_MS,
	};
	const response = await pinnedFetch(target, request);
	if (init.notFound?.includes(response.status)) return null;
	if (!response.ok) {
		throw new DnsProviderError(provider, response.status, summarizeErrorBody(response.body));
	}
	if (response.status === 204 || response.body.trim() === "") return null;
	try {
		return response.json() as T;
	} catch {
		throw new DnsProviderError(provider, response.status, "response was not JSON");
	}
}

/** The provider's own message when it has one, else the first bytes of the body. */
function summarizeErrorBody(body: string): string {
	const text = body.trim();
	if (!text) return "";
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		const message =
			firstString(parsed.message) ??
			firstString(parsed.error) ??
			firstString(parsed.detail) ??
			firstErrorMessage(parsed.errors);
		if (message) return message.slice(0, MAX_DETAIL);
	} catch {
		// Not JSON — fall through to the raw prefix.
	}
	return text.slice(0, MAX_DETAIL);
}

function firstString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (value && typeof value === "object" && "message" in value) {
		return firstString((value as { message: unknown }).message);
	}
	return null;
}

function firstErrorMessage(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	for (const entry of value) {
		const message = firstString(entry);
		if (message) return message;
	}
	return null;
}
