/**
 * Public URLs for service domains.
 *
 * A service's address is the thing operators look for first, so the panel
 * shows it on the service header and in the project services table instead of
 * hiding it behind the Domains tab. Only HTTP routers have a browser URL;
 * TCP/UDP rows route raw streams on a named entrypoint.
 */

export interface DomainLike {
	host: string;
	path?: string | null;
	https: boolean;
	protocol?: "http" | "tcp" | "udp" | null;
	previewDeploymentId?: string | null;
}

/** `https://app.example.com/admin` — null for TCP/UDP rows, which have no URL. */
export function domainUrl(domain: DomainLike): string | null {
	if (domain.protocol && domain.protocol !== "http") return null;
	if (!domain.host) return null;
	const path = domain.path && domain.path !== "/" ? domain.path : "";
	return `${domain.https ? "https" : "http"}://${domain.host}${path}`;
}

/**
 * The domain to show as *the* address of a service: HTTPS before plain HTTP,
 * then the oldest row (`domain.all` sorts newest first), so the answer stays
 * stable as extra domains come and go. Preview domains never win — they belong
 * to a pull request, not to the service.
 */
export function primaryDomain<T extends DomainLike>(domains: readonly T[]): T | null {
	const routable = domains.filter((domain) => !domain.previewDeploymentId && domainUrl(domain));
	if (routable.length === 0) return null;
	const secure = routable.filter((domain) => domain.https);
	const pool = secure.length > 0 ? secure : routable;
	return pool[pool.length - 1] ?? null;
}

/** Host + path without the scheme — what the UI shows as the link text. */
export function domainLabel(domain: DomainLike): string {
	const path = domain.path && domain.path !== "/" ? domain.path : "";
	return `${domain.host}${path}`;
}
