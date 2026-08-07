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
