import { assertSafeTenantHostPort } from "../../utils/validators";
import type { ComposeFileSpec, ComposeServiceSpec } from "./parse";
import { ComposeValidationError } from "./parse";

/**
 * Host ports published by a compose stack.
 *
 * Publishing is off by default and refused outright, because a stack that
 * binds :80 or :443 fights Traefik for the port on every node and routes
 * around the domain layer entirely — domains, TLS, middlewares and the
 * access log all stop applying. A stack that opts in still may not take a
 * privileged port, a well-known database port or one the platform owns:
 * the same rule managed databases publish under.
 *
 * Pure: every function here validates a parsed spec and nothing else.
 */

/** One published port, normalized from either compose syntax. */
export interface ComposePublishedPort {
	serviceName: string;
	/** Host side. `null` when compose was left to pick one (`ports: ["80"]`). */
	published: number | null;
	/** Container side. */
	target: number;
	protocol: "tcp" | "udp";
}

const parseProtocol = (value: unknown, serviceName: string): "tcp" | "udp" => {
	if (value === undefined || value === null || value === "tcp") return "tcp";
	if (value === "udp") return "udp";
	throw new ComposeValidationError(
		`Compose service "${serviceName}": port protocol must be tcp or udp`,
	);
};

const toPort = (value: string, serviceName: string, what: string): number => {
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || String(port) !== value.trim()) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": ${what} "${value}" is not a port number`,
		);
	}
	return port;
};

/**
 * Short form: `"8080:80"`, `"8080:80/udp"`, `"80"`, `"127.0.0.1:8080:80"`.
 *
 * A bind address is refused rather than honoured: Swarm's published ports
 * bind every interface (there is no `127.0.0.1:` form for a service port), so
 * accepting one would silently expose a port the author believed was local.
 */
function parseShortForm(serviceName: string, entry: string): ComposePublishedPort {
	const [spec, protocolPart] = entry.split("/");
	const protocol = parseProtocol(protocolPart ?? "tcp", serviceName);
	const parts = (spec ?? "").split(":");

	if (parts.length > 2) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": "${entry}" binds a host address, which a Swarm service cannot do — every published port listens on all interfaces`,
		);
	}
	if (parts.length === 1) {
		// `ports: ["80"]` — the container port only; docker picks the host one.
		return {
			serviceName,
			published: null,
			target: toPort(parts[0] ?? "", serviceName, "container port"),
			protocol,
		};
	}
	// A range ("8000-8010:80") would publish many ports from one entry.
	if ((parts[0] ?? "").includes("-") || (parts[1] ?? "").includes("-")) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": port ranges are not supported — list the ports individually`,
		);
	}
	return {
		serviceName,
		published: toPort(parts[0] ?? "", serviceName, "host port"),
		target: toPort(parts[1] ?? "", serviceName, "container port"),
		protocol,
	};
}

/** Long form: `{ target: 80, published: 8080, protocol: tcp, mode: host }`. */
function parseLongForm(serviceName: string, entry: Record<string, unknown>): ComposePublishedPort {
	const { target, published } = entry;
	if (typeof target !== "number" && typeof target !== "string") {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": a published port needs a target`,
		);
	}
	const targetPort = typeof target === "number" ? target : toPort(target, serviceName, "target");
	if (entry.host_ip !== undefined && entry.host_ip !== null) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}": host_ip is not supported — a Swarm published port listens on all interfaces`,
		);
	}
	return {
		serviceName,
		published:
			published === undefined || published === null
				? null
				: typeof published === "number"
					? published
					: typeof published === "string"
						? toPort(published, serviceName, "published")
						: null,
		target: targetPort,
		protocol: parseProtocol(entry.protocol, serviceName),
	};
}

/** Every port one service publishes, normalized. */
export function parseServicePorts(serviceName: string, ports: unknown): ComposePublishedPort[] {
	if (ports === undefined || ports === null) return [];
	if (!Array.isArray(ports)) {
		throw new ComposeValidationError(`Compose service "${serviceName}": ports must be a list`);
	}
	return ports.map((entry) => {
		if (typeof entry === "string") return parseShortForm(serviceName, entry);
		if (typeof entry === "number") return parseShortForm(serviceName, String(entry));
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			return parseLongForm(serviceName, entry as Record<string, unknown>);
		}
		throw new ComposeValidationError(
			`Compose service "${serviceName}": a port entry must be a string or a mapping`,
		);
	});
}

/**
 * Validate every published port in the stack, and refuse two services asking
 * for the same host port — docker would fail the deploy halfway through, after
 * some of the project is already replaced.
 */
export function assertSafeComposePorts(spec: ComposeFileSpec): ComposePublishedPort[] {
	const all: ComposePublishedPort[] = [];
	const claimed = new Map<string, string>();

	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		for (const port of parseServicePorts(serviceName, (service as ComposeServiceSpec).ports)) {
			if (port.published !== null) {
				assertSafeTenantHostPort(port.published, `published port`);
				const key = `${port.published}/${port.protocol}`;
				const owner = claimed.get(key);
				if (owner) {
					throw new ComposeValidationError(
						`Host port ${port.published}/${port.protocol} is published by both "${owner}" and "${serviceName}"`,
					);
				}
				claimed.set(key, serviceName);
			}
			all.push(port);
		}
	}
	return all;
}
