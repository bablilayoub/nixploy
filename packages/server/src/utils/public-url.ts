import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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
		throw new Error("URL host is not allowed");
	}
	if (isIP(host)) {
		assertPublicIp(host);
	}
}

export function assertPublicIp(ip: string): void {
	const normalized = ip.toLowerCase();
	if (normalized.includes(":")) {
		// IPv6: block loopback, link-local, ULA, and IPv4-mapped private.
		if (
			normalized === "::1" ||
			normalized === "::" ||
			normalized.startsWith("fe80:") ||
			normalized.startsWith("fc") ||
			normalized.startsWith("fd") ||
			normalized.startsWith("::ffff:")
		) {
			const mapped = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : null;
			if (!mapped || mapped.includes(":")) {
				throw new Error("URL host is not allowed");
			}
			assertPublicIp(mapped);
			return;
		}
		return;
	}
	const [a = -1, b = -1] = normalized.split(".").map(Number);
	if (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127)
	) {
		throw new Error("URL host is not allowed");
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

/**
 * Validate a notification / webhook URL is https to a non-private host.
 * Resolves DNS and checks every address to reduce rebinding risk.
 */
export async function assertPublicHttpsUrl(url: string): Promise<URL> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("Invalid URL");
	}
	if (parsed.protocol !== "https:") {
		throw new Error("URL must be https");
	}
	assertPublicHostname(parsed.hostname);
	if (!isIP(parsed.hostname)) {
		const records = await lookup(parsed.hostname, { all: true, verbatim: true });
		if (records.length === 0) {
			throw new Error("URL host could not be resolved");
		}
		for (const record of records) {
			assertPublicIp(record.address);
		}
	}
	return parsed;
}

/**
 * Outbound URL check for user-configured endpoints.
 * - Always blocks cloud metadata / link-local (including after DNS).
 * - `allowPrivate: true` permits literal LAN/loopback hosts (MinIO/Gotify).
 * - Public hostnames always have DNS resolved to block rebinding (nip.io → 169.254…).
 * - `allowHttp: true` permits http; otherwise https is required.
 */
export async function assertSafeOutboundUrl(
	url: string,
	options?: { allowPrivate?: boolean; allowHttp?: boolean },
): Promise<URL> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("Invalid URL");
	}
	const allowHttp = options?.allowHttp ?? options?.allowPrivate ?? false;
	if (parsed.protocol === "https:") {
		// ok
	} else if (parsed.protocol === "http:" && allowHttp) {
		// ok for self-hosted LAN endpoints
	} else {
		throw new Error(allowHttp ? "URL must be http(s)" : "URL must be https");
	}
	if (isCloudMetadataHostname(parsed.hostname)) {
		throw new Error("URL must not target cloud metadata");
	}

	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	let hostIsPrivate = false;
	try {
		assertPublicHostname(host);
	} catch {
		hostIsPrivate = true;
	}

	if (hostIsPrivate) {
		if (!options?.allowPrivate) {
			throw new Error("URL host is not allowed");
		}
		return parsed;
	}

	if (!isIP(host)) {
		const records = await lookup(host, { all: true, verbatim: true });
		if (records.length === 0) {
			throw new Error("URL host could not be resolved");
		}
		for (const record of records) {
			assertPublicIp(record.address);
		}
	} else {
		assertPublicIp(host);
	}
	return parsed;
}

/** SMTP host: hostname only (no scheme). Blocks metadata; optionally allows LAN. */
export function assertSafeSmtpHostname(hostname: string, allowPrivate = true): void {
	const host = hostname.trim().toLowerCase();
	if (!host || host.includes("/") || host.includes(" ")) {
		throw new Error("Invalid SMTP server hostname");
	}
	if (isCloudMetadataHostname(host)) {
		throw new Error("SMTP server must not target cloud metadata");
	}
	if (allowPrivate) {
		try {
			assertPublicHostname(host);
		} catch {
			return;
		}
		return;
	}
	assertPublicHostname(host);
}

/**
 * Git clone URLs: https or SSH only. Reject file:// and private HTTPS hosts.
 * SSH hosts are subject to the same hostname / DNS policy as HTTPS.
 */
export async function assertSafeGitCloneUrl(url: string): Promise<void> {
	const trimmed = url.trim();
	if (!trimmed || trimmed.startsWith("-")) {
		throw new Error("Invalid git URL");
	}
	const sshMatch = /^git@([^:]+):/.exec(trimmed) ?? /^ssh:\/\/(?:[^@]+@)?([^/]+)/i.exec(trimmed);
	if (sshMatch?.[1]) {
		const host = sshMatch[1].replace(/^\[|\]$/g, "").toLowerCase();
		if (isCloudMetadataHostname(host)) {
			throw new Error("git URL must not target cloud metadata");
		}
		assertPublicHostname(host);
		if (!isIP(host)) {
			const records = await lookup(host, { all: true, verbatim: true });
			for (const record of records) {
				assertPublicIp(record.address);
			}
		}
		return;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("Invalid git URL");
	}
	if (parsed.protocol === "file:" || parsed.protocol === "git:") {
		throw new Error("git URL scheme is not allowed");
	}
	if (parsed.protocol !== "https:") {
		throw new Error("git URL must be https or ssh");
	}
	assertPublicHostname(parsed.hostname);
	if (!isIP(parsed.hostname)) {
		const records = await lookup(parsed.hostname, { all: true, verbatim: true });
		for (const record of records) {
			assertPublicIp(record.address);
		}
	}
}

/** Scrub credentials / tokens from error text before DB/API/notifications. */
export function redactSensitiveText(text: string, secrets: readonly string[] = []): string {
	let out = text;
	out = out.replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1***:***@");
	out = out.replace(/(https?:\/\/)([^/\s:@]+)@/gi, "$1***@");
	out = out.replace(/\b(ghp_|gho_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]+/g, "***");
	for (const secret of secrets) {
		if (secret && secret.length > 0) {
			out = out.split(secret).join("**********");
		}
	}
	return out;
}
