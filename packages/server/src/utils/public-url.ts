import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { badRequest } from "../modules/errors";

/**
 * Outbound (SSRF) guard for every user-configured endpoint the panel talks to.
 *
 * Shape of the policy:
 *
 * 1. The host is canonicalised through `new URL()` (or, for SMTP, the same
 *    bracket/percent rules) so `0:0:0:0:0:0:0:1` and `[::1]` cannot slip past
 *    a string comparison.
 * 2. Every literal and every DNS answer is classified by
 *    {@link classifyIpAddress}: `blocked` ranges are never reachable,
 *    `overlay` (10.0.0.0/8 — the Swarm overlay) is never reachable as a
 *    literal, `private` needs the instance-admin toggle
 *    ({@link isPrivateEgressAllowed}), `public` is always fine.
 * 3. The vetted addresses come back in a {@link SafeTarget}. Callers must
 *    connect to those addresses — {@link pinnedFetch} does it for HTTP(S) —
 *    so a 0-TTL name cannot be re-pointed between validation and connect
 *    (DNS rebinding). Transports we do not own (nodemailer, git, the AWS SDK)
 *    re-resolve and compare instead: {@link assertAddressesUnchanged}.
 *
 * Node does not expose its bundled `undici` as a resolvable package
 * (`import { Agent } from "undici"` fails on Node 22), so the pinning hook is
 * `node:http`/`node:https` `request({ lookup })` rather than an undici
 * dispatcher. TLS still uses the original hostname for SNI and certificate
 * validation; only the address the socket dials is pinned.
 */

// ── IP classification ───────────────────────────────────────────────────────

/**
 * `public` — reachable. `private` — LAN/loopback, reachable only when the
 * instance admin turned on private egress. `overlay` — the Swarm overlay
 * (10.0.0.0/8), never reachable as a literal (the panel, Postgres and every
 * other tenant live there). `blocked` — never reachable under any setting.
 */
export type IpClass = "public" | "private" | "overlay" | "blocked";

const ipv4Class = (a: number, b: number, c: number, d: number): IpClass => {
	if (a === 0) return "blocked"; // "this network" / 0.0.0.0
	if (a === 10) return "overlay"; // RFC1918 /8 — Docker Swarm's default overlay
	if (a === 127) return "private"; // loopback
	if (a === 169 && b === 254) return "blocked"; // link-local incl. 169.254.169.254
	if (a === 172 && b >= 16 && b <= 31) return "private";
	if (a === 192 && b === 168) return "private";
	if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT
	if (a === 192 && b === 0 && c === 0) return "blocked"; // IETF protocol assignments
	if (a === 192 && b === 0 && c === 2) return "blocked"; // TEST-NET-1
	if (a === 198 && (b === 18 || b === 19)) return "blocked"; // benchmarking
	if (a === 198 && b === 51 && c === 100) return "blocked"; // TEST-NET-2
	if (a === 203 && b === 0 && c === 113) return "blocked"; // TEST-NET-3
	if (a >= 224) return "blocked"; // multicast (224/4) + reserved (240/4) + broadcast
	if (a === 255 && b === 255 && c === 255 && d === 255) return "blocked";
	return "public";
};

/** Expand an IPv6 literal into its eight 16-bit groups, or null if malformed. */
function expandIpv6(value: string): number[] | null {
	let text = value.toLowerCase().replace(/^\[|\]$/g, "");
	const zone = text.indexOf("%");
	if (zone !== -1) text = text.slice(0, zone);
	// Trailing IPv4 form (::ffff:1.2.3.4, 64:ff9b::1.2.3.4).
	const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
	if (v4?.[1]) {
		const octets = v4[1].split(".").map(Number);
		if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
		const [a = 0, b = 0, c = 0, d = 0] = octets;
		text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const parse = (part: string): number[] | null => {
		if (!part) return [];
		const groups: number[] = [];
		for (const group of part.split(":")) {
			if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
			groups.push(Number.parseInt(group, 16));
		}
		return groups;
	};
	const head = parse(halves[0] ?? "");
	const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
	if (!head || !tail) return null;
	if (halves.length === 1) return head.length === 8 ? head : null;
	const fill = 8 - head.length - tail.length;
	if (fill < 0) return null;
	return [...head, ...Array(fill).fill(0), ...tail];
}

/**
 * Canonical byte form of an IP literal: 4 bytes for IPv4, 16 for IPv6
 * (IPv4-mapped stays 16 bytes). `null` when the input is not an IP.
 * Shared with the CIDR matcher in `utils/rate-limit.ts`.
 */
export function ipToBytes(ip: string): Uint8Array | null {
	const value = ip
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");
	if (isIP(value) === 4) {
		const octets = value.split(".").map(Number);
		if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
			return null;
		}
		return Uint8Array.from(octets);
	}
	const groups = expandIpv6(value);
	if (!groups) return null;
	const bytes = new Uint8Array(16);
	groups.forEach((group, index) => {
		bytes[index * 2] = (group >> 8) & 0xff;
		bytes[index * 2 + 1] = group & 0xff;
	});
	return bytes;
}

/** Classify an IP literal (v4 or v6). Unparseable input is `blocked`. */
export function classifyIpAddress(ip: string): IpClass {
	const value = ip
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");
	if (isIP(value) === 4) {
		const [a = 0, b = 0, c = 0, d = 0] = value.split(".").map(Number);
		return ipv4Class(a, b, c, d);
	}
	const groups = expandIpv6(value);
	if (!groups) return "blocked";
	const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
	const embeddedV4 = (): IpClass => {
		const high = g6;
		const low = g7;
		return ipv4Class(high >> 8, high & 0xff, low >> 8, low & 0xff);
	};
	// ::ffff:0:0/96 (IPv4-mapped) and 64:ff9b::/96 (NAT64) carry a real IPv4.
	if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
		return embeddedV4();
	}
	if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
		return embeddedV4();
	}
	if (groups.every((g) => g === 0)) return "blocked"; // ::
	if (
		g0 === 0 &&
		g1 === 0 &&
		g2 === 0 &&
		g3 === 0 &&
		g4 === 0 &&
		g5 === 0 &&
		g6 === 0 &&
		g7 === 1
	) {
		return "private"; // ::1 loopback
	}
	if ((g0 & 0xff00) === 0xff00) return "blocked"; // ff00::/8 multicast
	if ((g0 & 0xffc0) === 0xfe80) return "blocked"; // fe80::/10 link-local
	if ((g0 & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique-local
	if (g0 === 0x2001 && g1 === 0x0db8) return "blocked"; // documentation
	if (g0 === 0x2001 && g1 === 0x0000) return "blocked"; // Teredo
	if (g0 === 0x2002) return "blocked"; // 6to4
	if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return "blocked"; // discard-only
	return "public";
}

/**
 * Names the platform owns on the Swarm overlay. Always unreachable as an
 * outbound target, whatever the private-egress toggle says — `nixploy:3000`
 * and `nixploy-postgres:5432` are the crown jewels behind a flat network.
 */
export const RESERVED_EGRESS_HOSTS = new Set([
	"nixploy",
	"nixploy-postgres",
	"nixploy-traefik",
	"traefik",
	"postgres",
]);

/**
 * A bare DNS label (no dot) is a Swarm service name on the overlay, i.e. a
 * service the organization deployed on this very instance — the legitimate
 * "self-hosted Gotify" case. Those stay reachable even with private egress
 * off; platform names and `localhost` never are.
 */
export function isOverlayServiceName(host: string): boolean {
	const value = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (!value || value.includes(".") || value.includes(":") || isIP(value)) return false;
	if (value === "localhost" || value.startsWith("nixploy-")) return false;
	if (RESERVED_EGRESS_HOSTS.has(value)) return false;
	return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value);
}

/** Block obvious SSRF targets (loopback / link-local / private / metadata). */
export function assertPublicHostname(hostname: string): void {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		host === "localhost" ||
		host === "metadata.google.internal" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal")
	) {
		throw badRequest("URL host is not allowed");
	}
	if (isIP(host)) {
		assertPublicIp(host);
	}
}

export function assertPublicIp(ip: string): void {
	if (classifyIpAddress(ip) !== "public") {
		throw badRequest("URL host is not allowed");
	}
}

export function isLoopbackHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	return (
		host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")
	);
}

/** True for cloud metadata / link-local targets that must never be fetched. */
export function isCloudMetadataHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	return (
		host === "169.254.169.254" ||
		host.startsWith("169.254.") ||
		host === "metadata.google.internal" ||
		host.startsWith("metadata.")
	);
}

// ── instance-admin private-egress toggle ────────────────────────────────────

const PRIVATE_EGRESS_TTL_MS = 30_000;
let privateEgressCache: { value: boolean; at: number } | null = null;

/** Test/boot hook: pin (or clear, with `null`) the cached toggle value. */
export function setPrivateEgressAllowedForTests(value: boolean | null): void {
	privateEgressCache = value === null ? null : { value, at: Number.POSITIVE_INFINITY };
}

/** Drop the cached toggle so the next check re-reads `web_server_settings`. */
export function invalidatePrivateEgressCache(): void {
	privateEgressCache = null;
}

/**
 * Whether this instance lets user-configured endpoints point at LAN /
 * loopback addresses. Instance-admin setting (`web_server_settings
 * .allow_private_egress`), **off by default**: a self-hosted MinIO, Gotify or
 * Gitea on the same LAN is a real use case, but so is an org admin using the
 * notification tester as a port scanner. `NIXPLOY_ALLOW_PRIVATE_EGRESS=1`
 * forces it on for installs that cannot reach the panel UI.
 */
export async function isPrivateEgressAllowed(): Promise<boolean> {
	if (process.env.NIXPLOY_ALLOW_PRIVATE_EGRESS === "1") return true;
	const now = Date.now();
	if (privateEgressCache && now - privateEgressCache.at < PRIVATE_EGRESS_TTL_MS) {
		return privateEgressCache.value;
	}
	let value = false;
	try {
		// Imported lazily: this module is on the import path of offline unit
		// tests that never open a database connection.
		const { db } = await import("../db");
		const row = await db.query.webServerSettings.findFirst();
		value = row?.allowPrivateEgress ?? false;
	} catch {
		value = false;
	}
	privateEgressCache = { value, at: now };
	return value;
}

// ── vetted targets ──────────────────────────────────────────────────────────

/**
 * A destination that passed the egress policy, plus the addresses it resolved
 * to. Connect to `addresses` — not to `url.hostname` — or the name can be
 * re-pointed between the check and the connect.
 */
export interface SafeTarget {
	url: URL;
	/** Vetted IP literals, in resolution order. Never empty. */
	addresses: string[];
	/** True when the target is a private/LAN address the toggle allowed. */
	isPrivate: boolean;
}

const denied = (label: string, reason: string): never => {
	throw badRequest(`${label} is not allowed (${reason})`);
};

/** Resolve `host` (or echo the literal) and apply the class policy to every answer. */
async function vetHost(
	host: string,
	options: { allowPrivate: boolean; label: string },
): Promise<{ addresses: string[]; isPrivate: boolean }> {
	const value = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (isCloudMetadataHostname(value)) denied(options.label, "cloud metadata");

	const overlayService = isOverlayServiceName(value);
	if (!overlayService && RESERVED_EGRESS_HOSTS.has(value)) {
		denied(options.label, "platform host");
	}
	if (
		!overlayService &&
		(value.endsWith(".localhost") || value.endsWith(".local") || value.endsWith(".internal"))
	) {
		if (!options.allowPrivate) denied(options.label, "private host");
	}

	let addresses: string[];
	if (isIP(value)) {
		addresses = [value];
	} else {
		let records: Array<{ address: string }>;
		try {
			records = await lookup(value, { all: true, verbatim: true });
		} catch {
			throw badRequest(`${options.label} could not be resolved`);
		}
		addresses = records.map((record) => record.address);
		if (addresses.length === 0) {
			throw badRequest(`${options.label} could not be resolved`);
		}
	}

	let isPrivate = false;
	for (const address of addresses) {
		const klass = classifyIpAddress(address);
		if (klass === "blocked") denied(options.label, "reserved or link-local address");
		if (klass === "overlay") {
			// The Swarm overlay is only ever a legitimate target through a
			// service NAME the organization deployed — never as a literal.
			if (!overlayService) denied(options.label, "cluster-internal address");
			isPrivate = true;
			continue;
		}
		if (klass === "private") {
			if (!overlayService && !options.allowPrivate) denied(options.label, "private address");
			isPrivate = true;
		}
	}
	return { addresses, isPrivate };
}

/**
 * Validate a notification / webhook URL is https to a non-private host.
 * Resolves DNS and checks every address; the answer is pinned in the result.
 */
export async function assertPublicHttpsUrl(url: string): Promise<SafeTarget> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw badRequest("Invalid URL");
	}
	if (parsed.protocol !== "https:") {
		throw badRequest("URL must be https");
	}
	const { addresses, isPrivate } = await vetHost(parsed.hostname, {
		allowPrivate: false,
		label: "URL host",
	});
	return { url: parsed, addresses, isPrivate };
}

/**
 * Outbound URL check for user-configured endpoints.
 * - Always blocks cloud metadata, link-local, reserved and overlay literals.
 * - `allowPrivate: true` means "this call site accepts a LAN target **if the
 *   instance admin turned private egress on**" — it is a request, not a
 *   decision (security audit 2.6: the per-provider defaults were the bug).
 * - Hostnames always have DNS resolved so rebinding (nip.io → 169.254…) is
 *   caught, and the answer is pinned into the returned {@link SafeTarget}.
 * - `allowHttp: true` permits http; otherwise https is required.
 */
export async function assertSafeOutboundUrl(
	url: string,
	options?: { allowPrivate?: boolean; allowHttp?: boolean },
): Promise<SafeTarget> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw badRequest("Invalid URL");
	}
	const allowHttp = options?.allowHttp ?? options?.allowPrivate ?? false;
	if (parsed.protocol === "https:") {
		// ok
	} else if (parsed.protocol === "http:" && allowHttp) {
		// ok for self-hosted LAN endpoints
	} else {
		throw badRequest(allowHttp ? "URL must be http(s)" : "URL must be https");
	}
	const allowPrivate = options?.allowPrivate === true && (await isPrivateEgressAllowed());
	const { addresses, isPrivate } = await vetHost(parsed.hostname, {
		allowPrivate,
		label: "URL host",
	});
	return { url: parsed, addresses, isPrivate };
}

/**
 * SMTP host: hostname only (no scheme). Canonicalised through `new URL()` so
 * `0:0:0:0:0:0:0:1` and `[::1]` collapse to the loopback literal. Returns the
 * vetted addresses — nodemailer resolves the name itself, so
 * {@link assertAddressesUnchanged} is the rebinding guard at send time.
 */
export async function assertSafeSmtpHostname(
	hostname: string,
	allowPrivate = true,
): Promise<SafeTarget> {
	const raw = hostname.trim().toLowerCase();
	if (!raw || raw.includes("/") || raw.includes(" ") || raw.includes("@")) {
		throw badRequest("Invalid SMTP server hostname");
	}
	let host: string;
	try {
		host = new URL(`smtp://${raw.includes(":") && !raw.startsWith("[") ? `[${raw}]` : raw}`)
			.hostname;
	} catch {
		throw badRequest("Invalid SMTP server hostname");
	}
	const effective = allowPrivate && (await isPrivateEgressAllowed());
	const { addresses, isPrivate } = await vetHost(host, {
		allowPrivate: effective,
		label: "SMTP server host",
	});
	return {
		url: new URL(`smtp://${host.includes(":") ? `[${host}]` : host}`),
		addresses,
		isPrivate,
	};
}

/**
 * Re-resolve `hostname` and fail unless it still answers with one of the
 * addresses vetted earlier. The rebinding guard for transports that do their
 * own DNS (nodemailer, git, the AWS SDK) and cannot be handed a `lookup` hook.
 */
export async function assertAddressesUnchanged(
	hostname: string,
	target: SafeTarget,
	label = "Host",
): Promise<void> {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (isIP(host)) return;
	let records: Array<{ address: string }>;
	try {
		records = await lookup(host, { all: true, verbatim: true });
	} catch {
		throw badRequest(`${label} could not be resolved`);
	}
	const vetted = new Set(target.addresses);
	for (const record of records) {
		if (classifyIpAddress(record.address) === "blocked" || !vetted.has(record.address)) {
			throw badRequest(`${label} changed address between validation and connect`);
		}
	}
}

/** Safe git ref: no leading dash, no shell/refspec metacharacters, no `..`. */
export function assertSafeGitRef(ref: string, label = "branch"): string {
	const value = ref.trim();
	if (
		!value ||
		value.length > 255 ||
		value.startsWith("-") ||
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.endsWith(".") ||
		value.endsWith(".lock") ||
		value.includes("..") ||
		value.includes("@{") ||
		!/^[A-Za-z0-9._\-/+]+$/.test(value)
	) {
		throw badRequest(`Invalid ${label}: ${ref}`);
	}
	return value;
}

/**
 * Git clone URLs: https or SSH only. Reject file:// and private hosts.
 * SSH hosts are subject to the same hostname / DNS policy as HTTPS.
 * Returns the vetted target so the caller can re-check it at clone time.
 */
export async function assertSafeGitCloneUrl(url: string): Promise<SafeTarget> {
	const trimmed = url.trim();
	if (!trimmed || trimmed.startsWith("-")) {
		throw badRequest("Invalid git URL");
	}
	const allowPrivate = await isPrivateEgressAllowed();
	const sshMatch = /^git@([^:]+):/.exec(trimmed) ?? /^ssh:\/\/(?:[^@]+@)?([^/]+)/i.exec(trimmed);
	if (sshMatch?.[1]) {
		const hostPort = sshMatch[1];
		const host = hostPort
			.replace(/^\[|\]$/g, "")
			.replace(/:\d+$/, "")
			.toLowerCase();
		const { addresses, isPrivate } = await vetHost(host, {
			allowPrivate,
			label: "git URL host",
		});
		return {
			url: new URL(`ssh://${host.includes(":") ? `[${host}]` : host}`),
			addresses,
			isPrivate,
		};
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw badRequest("Invalid git URL");
	}
	if (parsed.protocol === "file:" || parsed.protocol === "git:") {
		throw badRequest("git URL scheme is not allowed");
	}
	if (parsed.protocol !== "https:") {
		throw badRequest("git URL must be https or ssh");
	}
	const { addresses, isPrivate } = await vetHost(parsed.hostname, {
		allowPrivate,
		label: "git URL host",
	});
	return { url: parsed, addresses, isPrivate };
}

// ── pinned HTTP(S) ──────────────────────────────────────────────────────────

export interface PinnedFetchInit {
	method?: string;
	headers?: Record<string, string>;
	body?: string | Buffer;
	timeoutMs?: number;
	/** Hard cap on the captured response body (default 1 MiB). */
	maxBytes?: number;
}

export interface PinnedResponse {
	ok: boolean;
	status: number;
	statusText: string;
	body: string;
	/** Response headers, lower-cased names (a `Headers`-compatible getter). */
	headers: { get(name: string): string | null };
	text(): string;
	json(): unknown;
}

/** `dns.lookup`-shaped hook that only ever answers with the vetted addresses. */
function pinnedLookup(addresses: readonly string[]): LookupFunction {
	return ((
		_hostname: string,
		options: LookupOptions,
		callback: (
			err: NodeJS.ErrnoException | null,
			address: string | LookupAddress[],
			family?: number,
		) => void,
	): void => {
		const family =
			options?.family === 4 || options?.family === "IPv4"
				? 4
				: options?.family === 6 || options?.family === "IPv6"
					? 6
					: null;
		const wanted = family
			? addresses.filter((address) => isIP(address) === family)
			: [...addresses];
		const usable = wanted.length > 0 ? wanted : [...addresses];
		const first = usable[0];
		if (!first) {
			callback(Object.assign(new Error("No vetted address"), { code: "ENOTFOUND" }), "");
			return;
		}
		if (options?.all) {
			callback(
				null,
				usable.map((address) => ({ address, family: isIP(address) })),
			);
			return;
		}
		callback(null, first, isIP(first));
	}) as LookupFunction;
}

/**
 * HTTP(S) request that dials only the addresses vetted by the guard.
 * Redirects are never followed (a 3xx comes back as a non-`ok` response), the
 * body is capped, and TLS still validates the certificate against the
 * original hostname.
 */
export function pinnedFetch(
	target: SafeTarget,
	init: PinnedFetchInit = {},
): Promise<PinnedResponse> {
	const { url, addresses } = target;
	const secure = url.protocol === "https:";
	const transport = secure ? https : http;
	const timeoutMs = init.timeoutMs ?? 10_000;
	const maxBytes = init.maxBytes ?? 1024 * 1024;
	const host = url.hostname.replace(/^\[|\]$/g, "");

	return new Promise<PinnedResponse>((resolve, reject) => {
		const request = transport.request(
			{
				protocol: url.protocol,
				host,
				hostname: host,
				port: url.port || (secure ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				method: init.method ?? "GET",
				headers: init.headers ?? {},
				lookup: pinnedLookup(addresses),
			},
			(response) => {
				let body = "";
				let captured = 0;
				response.on("data", (chunk: Buffer) => {
					captured += chunk.length;
					if (captured <= maxBytes) body += chunk.toString("utf8");
				});
				response.on("end", () => {
					const status = response.statusCode ?? 0;
					const rawHeaders = response.headers;
					resolve({
						ok: status >= 200 && status < 300,
						status,
						statusText: response.statusMessage ?? "",
						headers: {
							get(name: string): string | null {
								const value = rawHeaders[name.toLowerCase()];
								if (value === undefined) return null;
								return Array.isArray(value) ? (value[0] ?? null) : value;
							},
						},
						body,
						text: () => body,
						json: () => (body ? JSON.parse(body) : null),
					});
				});
				response.on("error", reject);
			},
		);
		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error(`Request to ${url.host} timed out after ${timeoutMs}ms`));
		});
		request.on("error", reject);
		if (init.body !== undefined) request.write(init.body);
		request.end();
	});
}

/** Validate `url` then fetch it with the resolved address pinned. */
export async function safeFetch(
	url: string,
	options: { allowPrivate?: boolean; allowHttp?: boolean } = {},
	init: PinnedFetchInit = {},
): Promise<PinnedResponse> {
	const target = await assertSafeOutboundUrl(url, options);
	return await pinnedFetch(target, init);
}

// ── redaction ───────────────────────────────────────────────────────────────

/**
 * Credential/token shapes worth scrubbing wherever a provider error, build log
 * or webhook body might echo them back. Prefix families only — anything
 * shorter or less distinctive is handled by the caller's secret list.
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
	/\b(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|glptt-|xox[baprse]-|sk-ant-|sk-|shpat_|npm_|dop_v1_|hf_)[A-Za-z0-9_-]{8,}/g,
	// AWS access key ids (AKIA/ASIA/ABIA/ACCA + 16 base32 chars).
	/\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
	// JWTs: three base64url segments, the first decoding to a JOSE header.
	/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
];

/** Scrub credentials / tokens from error text before DB/API/notifications. */
export function redactSensitiveText(text: string, secrets: readonly string[] = []): string {
	let out = text;
	out = out.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1***:***@");
	out = out.replace(/(https?:\/\/)([^/\s:@]+)@/gi, "$1***@");
	for (const pattern of TOKEN_PATTERNS) {
		out = out.replace(pattern, "***");
	}
	for (const secret of secrets) {
		if (secret && secret.length > 0) {
			out = out.split(secret).join("**********");
		}
	}
	return out;
}
