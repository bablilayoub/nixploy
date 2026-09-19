import { isIP } from "node:net";
import { assertSafeOutboundUrl } from "../../utils/public-url";
import { detectPublicIp } from "../cluster/public-host";
import { badRequest } from "../errors";
import { getDashboardDomain } from "../traefik/dashboard";

export const MAX_TARGET_URL_LENGTH = 512;

export interface UpstreamTarget {
	/** Normalised origin (`https://host:443` → `https://host`). */
	url: string;
	/** True when the instance's private-egress toggle is what let a LAN target through. */
	isPrivate: boolean;
}

/** Thrown for a target that stopped resolving — transient, never a policy decision. */
export class UpstreamResolveError extends Error {}

/**
 * Validate the origin an external upstream routes to.
 *
 * Traefik dials this from inside the proxy container, which sits on both
 * platform overlays, so a permissive check here is a door into the panel
 * (`nixploy:3000`), Postgres and every other tenant's service — bypassing the
 * middlewares those tenants put on their own domains. Hence:
 * - the egress guard as for every tenant URL (cloud metadata, link-local and
 *   the overlay are always refused; LAN targets need the instance toggle);
 * - a bare name is refused outright: it would resolve on the Swarm overlay,
 *   which is exactly the "some other tenant's service" case;
 * - the dashboard's own host and the server's public address are refused,
 *   because either one routes the tenant's domain back into the panel.
 *
 * The check runs on write and again hourly (`recheckUpstreamTargets`), since
 * Traefik resolves the name itself on every request and a DNS record can be
 * re-pointed after it was vetted.
 */
export async function assertUpstreamTargetUrl(raw: string): Promise<UpstreamTarget> {
	const value = raw.trim();
	if (!value) throw badRequest("Target URL is required");
	if (value.length > MAX_TARGET_URL_LENGTH) throw badRequest("Target URL is too long");
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw badRequest(
			"Target URL must be an absolute http(s) URL, e.g. https://old-host.example.com",
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw badRequest("Target URL must use http or https");
	}
	if (parsed.username || parsed.password) {
		throw badRequest("Target URL must not carry credentials");
	}
	if (parsed.search || parsed.hash) {
		throw badRequest("Target URL must not carry a query string or fragment");
	}
	if (parsed.pathname !== "/" && parsed.pathname !== "") {
		throw badRequest(
			"Target URL is an origin only — set the path rewrite on the domain's internal path instead",
		);
	}
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (!hostname.includes(".") && !isIP(hostname)) {
		throw badRequest(
			"Target host must be a fully qualified name or an IP address — a bare name would resolve to a service on this Swarm",
		);
	}
	const [dashboard, publicIp] = await Promise.all([
		getDashboardDomain().catch(() => null),
		detectPublicIp().catch(() => null),
	]);
	if (dashboard && hostname === dashboard.toLowerCase()) {
		throw badRequest("Target URL must not be this panel's own address");
	}

	let target: Awaited<ReturnType<typeof assertSafeOutboundUrl>>;
	try {
		target = await assertSafeOutboundUrl(value, { allowPrivate: true, allowHttp: true });
	} catch (error) {
		if (error instanceof Error && /could not be resolved/.test(error.message)) {
			throw new UpstreamResolveError(`${hostname} could not be resolved`);
		}
		throw error;
	}
	if (publicIp && target.addresses.includes(publicIp)) {
		throw badRequest(
			"Target URL resolves to this server's own address — that would route the domain back into Traefik",
		);
	}
	return { url: parsed.origin, isPrivate: target.isPrivate };
}
