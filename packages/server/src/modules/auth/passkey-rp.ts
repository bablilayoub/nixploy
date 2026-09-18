/**
 * Which relying party a passkey is registered to.
 *
 * WebAuthn binds every credential to an **rpID** — a bare domain, no scheme and
 * no port — and the browser refuses to use a credential whose rpID is not a
 * registrable suffix of the page's own domain. Three consequences shape this
 * module:
 *
 * - **An IP address cannot be an rpID.** An install reached at `https://5.6.7.8`
 *   cannot offer passkeys at all, and the honest thing is to say so rather than
 *   register a plugin whose every call fails inside the browser with a message
 *   nobody can act on. `@better-auth/passkey` defaults `rpID` to `"localhost"`,
 *   which on a real install is exactly that silent failure.
 * - **Changing the panel's domain invalidates existing passkeys.** They were
 *   bound to the old one. Nothing can migrate them; the user enrols again.
 * - **The origin carries the port, the rpID does not.** `http://localhost:3100`
 *   is a valid origin for rpID `localhost`, which is what makes local
 *   development work without a domain.
 *
 * Pure on purpose — no database, no better-auth import — so the decision is
 * testable without either.
 */

/** Dotted-quad or bracketed IPv6; neither can be a WebAuthn rpID. */
const isIpLiteral = (host: string): boolean =>
	/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");

/** `localhost` and its subdomains are the one non-domain browsers accept. */
const isLocalhost = (host: string): boolean => host === "localhost" || host.endsWith(".localhost");

/** A hostname browsers will accept as a relying party. */
export function isUsableRpId(host: string): boolean {
	const value = host.trim().toLowerCase();
	if (!value || value.length > 253) return false;
	if (isIpLiteral(value)) return false;
	if (isLocalhost(value)) return true;
	// A registrable domain needs at least one dot, and every label has to be a
	// plain DNS label — a host that reaches us through some proxy rewrite is not
	// something to hand to the browser as an identity.
	return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(value);
}

export interface PasskeyRelyingParty {
	/** Bare domain the credentials are bound to. */
	rpId: string;
	/**
	 * Origins the browser may present. More than one because a development
	 * checkout and the configured domain can both be legitimate, and better-auth
	 * accepts a list.
	 */
	origins: string[];
}

/** Origin of a URL string, or null when it is not one. */
const originOf = (raw: string | null | undefined): URL | null => {
	if (!raw?.trim()) return null;
	try {
		return new URL(raw.trim());
	} catch {
		return null;
	}
};

/**
 * Decide the relying party for this instance, or `null` when passkeys cannot
 * work here.
 *
 * The configured dashboard domain wins: it is the address people actually visit
 * and the one with a certificate. `BETTER_AUTH_URL` is the fallback, and the
 * only source during a first-run install before anything is configured.
 */
export function resolvePasskeyRelyingParty(
	dashboardHost: string | null | undefined,
	baseUrl: string | null | undefined,
): PasskeyRelyingParty | null {
	const origins: string[] = [];
	const base = originOf(baseUrl);
	if (base) origins.push(base.origin);

	const configured = dashboardHost?.trim().toLowerCase();
	if (configured && isUsableRpId(configured)) {
		const httpsOrigin = `https://${configured}`;
		if (!origins.includes(httpsOrigin)) origins.push(httpsOrigin);
		return { rpId: configured, origins };
	}

	if (base && isUsableRpId(base.hostname)) {
		return { rpId: base.hostname.toLowerCase(), origins };
	}

	// Either nothing is configured, or what is configured is an IP address.
	return null;
}

/** Why passkeys are unavailable, for the panel to show instead of a dead button. */
export const PASSKEY_UNAVAILABLE_REASON =
	"Passkeys need the panel to have a domain name. WebAuthn binds a credential to a domain, and an instance reached by IP address has none to bind to — set the panel domain in Settings → Platform first.";
