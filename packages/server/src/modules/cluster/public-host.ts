/**
 * The address the outside world reaches THIS host on — what an external
 * database connection URL, a DNS check or a "point your domain here" hint
 * should show. Resolution order:
 *
 *   1. `NIXPLOY_PUBLIC_HOST` — explicit hostname or IP set by the operator
 *      (a NAT'd box, a DNS name in front of the IP, IPv6-only hosts).
 *   2. The detected public IPv4 (api.ipify.org, cached for 10 minutes) —
 *      the right answer for the usual VPS install.
 *   3. `localhost` — only when detection fails, or in development where the
 *      detected address would be the developer's NAT gateway.
 *
 * The cache lives on `globalThis`: Next's `transpilePackages` evaluates this
 * module twice (route chunks vs the custom server), see deployment/events.ts.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const DETECT_TIMEOUT_MS = 4_000;

interface PublicIpCache {
	value: string | null;
	expiresAt: number;
}

const globalForPublicIp = globalThis as typeof globalThis & {
	__nixployPublicIp?: PublicIpCache;
};

/** Is this process a production install (not a developer's laptop)? */
function isProductionRuntime(): boolean {
	return process.env.NODE_ENV === "production";
}

/** Public IPv4 of this host, or null when detection fails (offline, etc.). */
export async function detectPublicIp(options: { fresh?: boolean } = {}): Promise<string | null> {
	const cached = globalForPublicIp.__nixployPublicIp;
	if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
	let value: string | null = null;
	try {
		const res = await fetch("https://api.ipify.org", {
			signal: controller.signal,
			redirect: "error",
		});
		const text = (await res.text()).trim();
		value = /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ? text : null;
	} catch {
		value = null;
	} finally {
		clearTimeout(timer);
	}
	// A failed lookup is cached briefly too, so an offline host does not pay
	// the timeout on every connection-URL render.
	globalForPublicIp.__nixployPublicIp = {
		value,
		expiresAt: Date.now() + (value ? CACHE_TTL_MS : 30_000),
	};
	return value;
}

/** Drop the cached address (tests, or after the operator changes the setting). */
export function resetPublicIpCache(): void {
	globalForPublicIp.__nixployPublicIp = undefined;
}

/**
 * Host to show in an external connection URL for services on the Nixploy
 * host itself. Remote servers use their own `ipAddress` row instead.
 */
export async function resolveLocalPublicHost(): Promise<string> {
	const explicit = process.env.NIXPLOY_PUBLIC_HOST?.trim();
	if (explicit) return explicit;
	if (!isProductionRuntime()) return "localhost";
	return (await detectPublicIp()) ?? "localhost";
}
