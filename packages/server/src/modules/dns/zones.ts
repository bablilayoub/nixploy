/**
 * Pure helpers for "which zone does this host live in, and what is the record
 * called there" — shared by every provider client so the naming rules live in
 * one place and are unit-tested once.
 *
 * Record names are **relative to the zone** on the way in: `@` for the apex,
 * `app` for `app.example.com` in `example.com`, `*.apps` for a wildcard. Each
 * provider client translates to its own convention (Cloudflare wants the
 * FQDN, Vultr wants `""` for the apex, …) via {@link fqdnOf}.
 */

export interface DnsZone {
	/** Provider's identifier for the zone (Cloudflare id, or the name itself). */
	id: string;
	/** Zone apex, lower-cased, no trailing dot (`example.com`). */
	name: string;
}

/** Lower-case, strip the trailing dot and surrounding whitespace. */
export function normalizeHost(host: string): string {
	return host.trim().toLowerCase().replace(/\.+$/, "");
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Hosts a public DNS provider can never hold a record for: IP literals,
 * bare names, and the magic-DNS domains that resolve on their own
 * (`*.traefik.me`, `*.sslip.io`, `*.nip.io`, `*.localhost`).
 */
export function isAutomatableHost(host: string): boolean {
	const name = normalizeHost(host);
	if (name === "" || !name.includes(".")) return false;
	if (IPV4_LITERAL.test(name) || name.includes(":")) return false;
	const magic = [".traefik.me", ".sslip.io", ".nip.io", ".localhost", ".local", ".internal"];
	return !magic.some((suffix) => name.endsWith(suffix));
}

/**
 * The zone whose apex is the longest suffix of `host` — `app.eu.example.com`
 * with zones `example.com` and `eu.example.com` picks the second. A wildcard
 * host is matched on its parent (`*.apps.example.com` lives wherever
 * `apps.example.com` does).
 */
export function findZoneForHost<Z extends DnsZone>(host: string, zones: readonly Z[]): Z | null {
	const name = normalizeHost(host).replace(/^\*\./, "");
	let best: Z | null = null;
	for (const zone of zones) {
		const apex = normalizeHost(zone.name);
		if (!apex) continue;
		if (name !== apex && !name.endsWith(`.${apex}`)) continue;
		if (!best || apex.length > normalizeHost(best.name).length) best = zone;
	}
	return best;
}

/** `app.example.com` in `example.com` → `app`; the apex itself → `@`. */
export function relativeRecordName(host: string, zoneName: string): string {
	const name = normalizeHost(host);
	const apex = normalizeHost(zoneName);
	if (name === apex) return "@";
	if (!name.endsWith(`.${apex}`)) {
		throw new Error(`${host} is not inside zone ${zoneName}`);
	}
	return name.slice(0, -(apex.length + 1));
}

/** The inverse of {@link relativeRecordName}, for providers that want the FQDN. */
export function fqdnOf(zoneName: string, relative: string): string {
	const apex = normalizeHost(zoneName);
	return relative === "@" || relative === "" ? apex : `${relative}.${apex}`;
}

/**
 * Every apex a host could belong to, longest first — `a.b.example.com` gives
 * `a.b.example.com`, `b.example.com`, `example.com`. For providers whose zone
 * lookup is by exact name (Cloudflare's `?name=`), asking for these in turn
 * avoids paging through every zone on the account.
 */
export function candidateZoneNames(host: string): string[] {
	const labels = normalizeHost(host).replace(/^\*\./, "").split(".");
	const out: string[] = [];
	for (let i = 0; i < labels.length - 1; i += 1) {
		out.push(labels.slice(i).join("."));
	}
	return out;
}
