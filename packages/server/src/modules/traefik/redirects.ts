import { badRequest } from "../errors";

/**
 * Redirect rule validation shared by the redirect router and the GitOps
 * apply. Pure module (no db / fs imports).
 */

export const REDIRECT_REGEX_MAX = 256;
export const REDIRECT_REPLACEMENT_MAX = 512;

/**
 * `replacement` is written verbatim into a Traefik `redirectRegex`, so an
 * absolute URL there is an open redirect on the tenant's own domain
 * (security.md §2.6). Absolute replacements must therefore be `https://`, or
 * point at one of the service's own hosts; relative ones stay same-host by
 * construction.
 */
export function assertSafeRedirectRule(
	regex: string,
	replacement: string,
	ownHosts: string[],
): void {
	if (regex.length > REDIRECT_REGEX_MAX || replacement.length > REDIRECT_REPLACEMENT_MAX) {
		throw badRequest("Redirect pattern is too long");
	}
	if (/[()]/.test(regex) || /\\[0-9]/.test(regex)) {
		throw badRequest("Redirect regex must not use capturing groups or backreferences");
	}
	if (!/^[\w\-./*?^$|[\]{}+\\: =@%&]+$/.test(regex)) {
		throw badRequest("Redirect regex contains invalid characters");
	}
	// The whitelist admits syntactically broken patterns (`[`, `a{2,1}`).
	// Traefik then fails to build the middleware and, since it is attached
	// to every router of the app, the whole app 404s. JS and RE2 agree on
	// the allowed character set closely enough to catch these up front.
	try {
		// `RegExp(...)` without `new` parses the pattern just the same; the
		// object is thrown away, only the SyntaxError matters here.
		RegExp(regex);
	} catch {
		throw badRequest("Redirect regex is not a valid regular expression");
	}
	if (replacement.includes("://")) {
		if (!/^https?:\/\/[^\s]+$/i.test(replacement)) {
			throw badRequest("Invalid redirect replacement URL");
		}
		let host: string;
		try {
			// Traefik capture placeholders (`${1}`) are legal URL characters.
			host = new URL(replacement).hostname.toLowerCase();
		} catch {
			throw badRequest("Invalid redirect replacement URL");
		}
		const sameHost = ownHosts.includes(host);
		if (!replacement.toLowerCase().startsWith("https://") && !sameHost) {
			throw badRequest(
				"An absolute redirect must use https:// (or point at one of this service's own domains)",
			);
		}
		return;
	}
	if (!replacement.startsWith("/")) {
		throw badRequest("Redirect replacement must be a path or http(s) URL");
	}
}
