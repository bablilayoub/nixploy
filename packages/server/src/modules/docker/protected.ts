/**
 * Platform resources created by `install.sh` / Traefik setup that must never
 * be stopped, restarted or removed from the Docker control center.
 */

import { getSwarmNetwork } from "../application/paths";

/** Exact Swarm/service names owned by Nixploy itself. */
export const PROTECTED_PLATFORM_NAMES = ["nixploy", "nixploy-postgres", "nixploy-traefik"] as const;

/** The shared overlay network must never be removed from the UI. */
export const PROTECTED_NETWORKS = new Set(["bridge", "host", "none", "ingress", getSwarmNetwork()]);

/** Named volume backing the Nixploy Postgres service. */
export const PROTECTED_VOLUMES = new Set(["nixploy-postgres-data"]);

/**
 * True when `name` is (or is a Swarm task of) a Nixploy platform service.
 * Swarm tasks appear as `<service>.<slot>.<taskId>`.
 */
export function isProtectedPlatformName(name: string): boolean {
	const normalized = name.replace(/^\//, "").trim();
	if (!normalized) return false;
	return PROTECTED_PLATFORM_NAMES.some(
		(platform) => normalized === platform || normalized.startsWith(`${platform}.`),
	);
}

/**
 * `docker ps` Names can be comma-separated (multiple aliases). Any alias that
 * matches a platform service marks the whole container as protected.
 */
export function isProtectedContainerNames(names: string): boolean {
	return names
		.split(",")
		.map((part) => part.trim())
		.some(isProtectedPlatformName);
}
