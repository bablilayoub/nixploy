import { isIP } from "node:net";
import { z } from "zod";
import { badRequest } from "../modules/errors";
import { classifyIpAddress } from "./public-url";

/** Docker named volume / compose service name character set. */
export const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/** Swarm/service DNS name: lowercase, hyphenated, 3–63 chars. */
export const APP_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Names that would be dangerous as `pkill -f` patterns or collide with the platform. */
export const RESERVED_APP_NAMES = new Set([
	"node",
	"npm",
	"pnpm",
	"yarn",
	"docker",
	"dockerd",
	"containerd",
	"sh",
	"bash",
	"zsh",
	"python",
	"python3",
	"nixploy",
	"nixploy-postgres",
	"nixploy-traefik",
	"traefik",
	"postgres",
	"redis",
	"mongo",
	"mysql",
	"mariadb",
	// Basenames of the platform's own Traefik dynamic files (see
	// modules/traefik/dashboard.ts): an app with either name would overwrite
	// the panel's routing / default TLS store on its first domain.
	"00-nixploy-dashboard",
	"00-default-tls",
]);

/**
 * Name shapes owned by the platform: `<app>-pr-<n>` is the swarm service +
 * Traefik file of a PR preview.
 */
export const RESERVED_APP_NAME_PATTERNS: readonly RegExp[] = [/-pr-\d+$/];

export const isReservedAppName = (value: string): boolean =>
	RESERVED_APP_NAMES.has(value) || RESERVED_APP_NAME_PATTERNS.some((re) => re.test(value));

/** Zod-friendly appName schema shared by routers + GitOps. */
export const appNameSchema = z
	.string()
	.min(3)
	.max(63)
	.regex(APP_NAME_RE, "appName must be a lowercase DNS label (a-z0-9-)")
	.refine((value) => !isReservedAppName(value), "appName is reserved")
	.refine((value) => !value.includes(".."), "appName must not contain '..'");

export function assertSafeAppName(appName: string): string {
	const trimmed = appName.trim();
	const parsed = appNameSchema.safeParse(trimmed);
	if (!parsed.success) {
		throw badRequest(parsed.error.issues[0]?.message ?? `Invalid appName: ${appName}`);
	}
	return parsed.data;
}

/** Safe Traefik Host() value — FQDN / hostname labels only. */
export const TRAEFIK_HOST_RE =
	/^(?=.{1,253}$)(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*\.?$/;

/** Safe Traefik PathPrefix() value. */
export const TRAEFIK_PATH_RE = /^\/[A-Za-z0-9._~/-]*$/;

export function assertDockerVolumeName(volumeName: string): void {
	if (!DOCKER_NAME_RE.test(volumeName) || volumeName.includes("..")) {
		throw badRequest(
			`Invalid Docker volume name "${volumeName}" (must match ${DOCKER_NAME_RE.source})`,
		);
	}
}

export function assertTraefikHost(host: string): string {
	const trimmed = host.trim().toLowerCase();
	if (!TRAEFIK_HOST_RE.test(trimmed) || /[`()|]/.test(trimmed)) {
		throw badRequest(`Invalid domain host: ${host}`);
	}
	return trimmed;
}

export function assertTraefikPath(path: string | null | undefined): string | null {
	if (!path || path === "/") return path === "/" ? "/" : null;
	if (!TRAEFIK_PATH_RE.test(path) || path.includes("..") || /[`()|]/.test(path)) {
		throw badRequest(`Invalid domain path: ${path}`);
	}
	return path;
}

export function assertComposeServiceName(serviceName: string): void {
	if (!DOCKER_NAME_RE.test(serviceName)) {
		throw badRequest(`Invalid compose service name: ${serviceName}`);
	}
}

export function assertBasicAuthUsername(username: string): void {
	if (!/^[A-Za-z0-9._@+-]+$/.test(username) || username.includes(":")) {
		throw badRequest("Invalid basic-auth username");
	}
}

/**
 * Host-published ports that must never be opened by apps/DBs/compose
 * (Docker API, SSH, common DB binds on the host). Privileged ports (<1024)
 * are also rejected by {@link assertSafePublishedPort}.
 */
export const BLOCKED_HOST_PORTS = new Set([
	22, 23, 25, 53, 111, 135, 139, 445, 1433, 1521, 2049, 2375, 2376, 2377, 3306, 3389, 5432, 5900,
	6379, 6443, 9200, 10250, 27017, 11211,
]);

export function assertSafePublishedPort(port: number, label = "publishedPort"): void {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw badRequest(`Invalid ${label}`);
	}
	if (BLOCKED_HOST_PORTS.has(port) || port < 1024) {
		throw badRequest(
			`${label} ${port} is not allowed (privileged or sensitive host ports are blocked)`,
		);
	}
}

/**
 * Safe `docker pull` / image reference: no whitespace, no leading dashes
 * (flag injection), and only common OCI ref characters.
 */
export const DOCKER_IMAGE_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@+]*$/;

/**
 * Registry host of an image reference (Docker's own rule: the first path
 * component is a registry only when it contains `.` / `:` or is `localhost`).
 * Duplicated from `modules/deployment/sources.ts` so validators stay free of
 * deployment imports; both are covered by tests.
 */
function registryHostOf(reference: string): { host: string; explicit: boolean } {
	const slash = reference.indexOf("/");
	if (slash === -1) return { host: "docker.io", explicit: false };
	const first = reference.slice(0, slash).toLowerCase();
	if (first.includes(".") || first.includes(":") || first === "localhost") {
		return { host: first.replace(/:\d+$/, ""), explicit: true };
	}
	return { host: "docker.io", explicit: false };
}

/**
 * True when pulling from this registry host would make the Docker daemon
 * reach into the LAN / the Swarm overlay — a blind SSRF primitive with the
 * daemon's network position (security audit 2.6).
 */
export function isPrivateRegistryHost(host: string): boolean {
	const value = host
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/:\d+$/, "");
	if (!value) return false;
	if (value === "localhost" || value.endsWith(".localhost")) return true;
	if (value.endsWith(".local") || value.endsWith(".internal")) return true;
	if (!value.includes(".") && !value.includes(":")) return true; // bare label = overlay service
	if (isIP(value)) return classifyIpAddress(value) !== "public";
	return false;
}

/**
 * Charset check plus: an image whose registry host is private is only
 * pullable when the organization has a matching `selfHosted` registry row.
 * `allowedHosts` holds those hosts (bare, no port, no scheme).
 */
export function assertPullableImageRef(
	reference: string,
	allowedHosts: Iterable<string> = [],
): string {
	const trimmed = assertSafeDockerImageRef(reference);
	const { host, explicit } = registryHostOf(trimmed);
	if (!explicit || !isPrivateRegistryHost(host)) return trimmed;
	const allowed = new Set(
		[...allowedHosts].map((value) =>
			value
				.trim()
				.toLowerCase()
				.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
				.split("/")[0]
				?.replace(/:\d+$/, ""),
		),
	);
	if (allowed.has(host)) return trimmed;
	throw badRequest(
		`Image ${reference} points at the private registry "${host}". Add it as a self-hosted registry first.`,
	);
}

export function assertSafeDockerImageRef(reference: string): string {
	const trimmed = reference.trim();
	if (
		!trimmed ||
		trimmed.length > 512 ||
		trimmed.startsWith("-") ||
		trimmed.includes("..") ||
		!DOCKER_IMAGE_REF_RE.test(trimmed)
	) {
		throw badRequest(`Invalid Docker image reference: ${reference}`);
	}
	return trimmed;
}
