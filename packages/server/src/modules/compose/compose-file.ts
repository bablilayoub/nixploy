import { parse, stringify } from "yaml";
import { getSwarmNetwork } from "../application/paths";

/**
 * Loose shape of a docker-compose / stack file. Only the keys this module
 * transforms are typed; everything else is passed through untouched.
 */
export interface ComposeServiceSpec {
	networks?: string[] | Record<string, { aliases?: string[] } & Record<string, unknown>>;
	depends_on?: string[] | Record<string, unknown>;
	links?: string[];
	[key: string]: unknown;
}

export interface ComposeFileSpec {
	services?: Record<string, ComposeServiceSpec>;
	networks?: Record<string, unknown>;
	[key: string]: unknown;
}

export function parseComposeFile(content: string): ComposeFileSpec {
	const spec = parse(content) as ComposeFileSpec | null;
	if (!spec || typeof spec !== "object") {
		throw new Error("Invalid compose file: not a YAML mapping");
	}
	if (!spec.services || Object.keys(spec.services).length === 0) {
		throw new Error("Invalid compose file: no services defined");
	}
	return spec;
}

/** Names of the services defined in a compose file. */
export function listComposeServices(content: string): string[] {
	const spec = parseComposeFile(content);
	return Object.keys(spec.services ?? {});
}

const BLOCKED_CAP_ADD = new Set([
	"ALL",
	"SYS_ADMIN",
	"SYS_MODULE",
	"SYS_PTRACE",
	"SYS_RAWIO",
	"SYS_BOOT",
	"SYS_TIME",
	"SYS_NICE",
	"MKNOD",
	"MAC_ADMIN",
	"MAC_OVERRIDE",
	"NET_ADMIN",
	"NET_RAW",
	"DAC_READ_SEARCH",
	"DAC_OVERRIDE",
	"BPF",
	"PERFMON",
	"AUDIT_CONTROL",
	"AUDIT_READ",
	"SYSLOG",
]);

/** Caps allowed when a compose row was created from a host-privileged template. */
const HOST_PRIVILEGED_CAPS = new Set(["NET_ADMIN", "SYS_MODULE"]);

const DOCKER_SOCKET_SOURCES = new Set(["/var/run/docker.sock", "/run/docker.sock"]);

export interface ComposeSafetyOptions {
	/** Allow bind-mount of the Docker engine socket only (exact host paths). */
	allowDockerSocket?: boolean;
	/** Capability names (without `CAP_` prefix) permitted despite the denylist. */
	allowCapabilities?: ReadonlySet<string> | readonly string[];
	/** Allow `sysctls` (needed for VPN templates like wg-easy). */
	allowSysctls?: boolean;
}

/** Safety options used for instance-admin host-privileged compose rows. */
export function hostPrivilegedComposeSafety(): ComposeSafetyOptions {
	return {
		allowDockerSocket: true,
		allowCapabilities: HOST_PRIVILEGED_CAPS,
		allowSysctls: true,
	};
}

function allowedCapSet(options?: ComposeSafetyOptions): Set<string> {
	const allowed = new Set<string>();
	if (!options?.allowCapabilities) return allowed;
	for (const cap of options.allowCapabilities) {
		allowed.add(cap.toUpperCase().replace(/^CAP_/, ""));
	}
	return allowed;
}

function isDockerSocketSource(source: string): boolean {
	return DOCKER_SOCKET_SOURCES.has(source.trim());
}

function isTruthy(value: unknown): boolean {
	if (value === true || value === 1) return true;
	if (typeof value === "string") {
		const lower = value.trim().toLowerCase();
		return lower === "true" || lower === "yes" || lower === "1" || lower === "on";
	}
	return false;
}

/** Collect volume sources; rejects long-form bind/tmpfs and non-array shapes. */
function assertAndCollectVolumeSources(
	serviceName: string,
	volumes: unknown,
	options?: ComposeSafetyOptions,
): string[] {
	if (volumes === undefined || volumes === null) return [];
	if (!Array.isArray(volumes)) {
		throw new Error(`Compose service "${serviceName}" volumes must be an array of mounts`);
	}
	const sources: string[] = [];
	for (const entry of volumes) {
		if (typeof entry === "string") {
			const host = entry.split(":")[0]?.trim();
			if (host) sources.push(host);
			continue;
		}
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			const obj = entry as Record<string, unknown>;
			const type = String(obj.type ?? obj.Type ?? "volume")
				.trim()
				.toLowerCase();
			const source =
				typeof obj.source === "string"
					? obj.source
					: typeof obj.Source === "string"
						? obj.Source
						: "";
			if (type === "tmpfs" || type === "npipe") {
				throw new Error(
					`Compose service "${serviceName}" must not use volumes type: ${type} (named volumes only)`,
				);
			}
			if (type === "bind") {
				if (!(options?.allowDockerSocket && isDockerSocketSource(source))) {
					throw new Error(
						`Compose service "${serviceName}" must not use volumes type: bind (named volumes only)`,
					);
				}
			}
			if (source) sources.push(source);
			continue;
		}
		throw new Error(`Compose service "${serviceName}" has an invalid volumes entry`);
	}
	return sources;
}

function labelEntries(labels: unknown): Array<[string, string]> {
	if (!labels) return [];
	if (Array.isArray(labels)) {
		return labels
			.filter((line): line is string => typeof line === "string" && line.includes("="))
			.map((line) => {
				const i = line.indexOf("=");
				return [line.slice(0, i), line.slice(i + 1)] as [string, string];
			});
	}
	if (typeof labels === "object") {
		return Object.entries(labels as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]);
	}
	return [];
}

function assertSafeNamedVolumes(volumes: unknown): void {
	if (!volumes || typeof volumes !== "object" || Array.isArray(volumes)) return;
	for (const [name, def] of Object.entries(volumes as Record<string, unknown>)) {
		if (def === null || def === undefined) continue;
		if (typeof def !== "object" || Array.isArray(def)) continue;
		const record = def as Record<string, unknown>;
		if (
			record.external === true ||
			typeof record.external === "string" ||
			(typeof record.external === "object" && record.external !== null)
		) {
			throw new Error(
				`Compose volume "${name}" must not use external: (attaching host volumes is blocked)`,
			);
		}
		const opts = record.driver_opts;
		if (!opts || typeof opts !== "object" || Array.isArray(opts)) continue;
		const map = opts as Record<string, unknown>;
		const type = String(map.type ?? map.Type ?? "").toLowerCase();
		const o = String(map.o ?? map.options ?? "").toLowerCase();
		const device = String(map.device ?? map.Device ?? "");
		if (type === "none" || o.includes("bind") || device.startsWith("/") || device.startsWith(".")) {
			throw new Error(
				`Compose volume "${name}" must not use host bind driver_opts (type/o/device)`,
			);
		}
	}
}

function assertSafeConfigsOrSecrets(kind: "configs" | "secrets", value: unknown): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	for (const [name, def] of Object.entries(value as Record<string, unknown>)) {
		if (!def || typeof def !== "object" || Array.isArray(def)) continue;
		const record = def as Record<string, unknown>;
		const file = record.file ?? record.File;
		if (typeof file === "string" && file.trim()) {
			throw new Error(`Compose ${kind} "${name}" must not use file: (host path reads are blocked)`);
		}
		const environment = record.environment ?? record.Environment;
		if (typeof environment === "string" && environment.trim()) {
			throw new Error(
				`Compose ${kind} "${name}" must not use environment: (host env reads are blocked)`,
			);
		}
		if (
			record.external === true ||
			typeof record.external === "string" ||
			(typeof record.external === "object" && record.external !== null)
		) {
			throw new Error(
				`Compose ${kind} "${name}" must not use external: (cross-stack attach is blocked)`,
			);
		}
	}
}

/**
 * Reject compose features that escape the container into the Nixploy host
 * (docker.sock, privileged, host namespaces, dangerous caps, Traefik label hijack).
 *
 * `options` is only for instance-admin host-privileged templates / rows — still
 * blocks privileged mode, host namespaces, arbitrary binds, and Traefik labels.
 */
export function assertSafeComposeSpec(spec: ComposeFileSpec, options?: ComposeSafetyOptions): void {
	if (spec.include !== undefined && spec.include !== null) {
		throw new Error('Compose "include" is not allowed');
	}
	if (spec.extends !== undefined && spec.extends !== null) {
		throw new Error('Compose top-level "extends" is not allowed');
	}
	assertSafeNamedVolumes(spec.volumes);
	assertSafeConfigsOrSecrets("configs", spec.configs);
	assertSafeConfigsOrSecrets("secrets", spec.secrets);

	const allowedCaps = allowedCapSet(options);

	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		if (service.extends !== undefined && service.extends !== null) {
			throw new Error(`Compose service "${serviceName}" must not use extends`);
		}
		if (service.build !== undefined && service.build !== null) {
			throw new Error(
				`Compose service "${serviceName}" must not use build: (host context / dockerfile_inline reads are blocked)`,
			);
		}
		if (service.env_file !== undefined && service.env_file !== null) {
			throw new Error(
				`Compose service "${serviceName}" must not use env_file: (host path reads are blocked)`,
			);
		}

		// Env interpolation runs after this check — reject ${…} in dangerous fields.
		const dangerousKeys = [
			"privileged",
			"network_mode",
			"pid",
			"ipc",
			"uts",
			"cgroup",
			"cgroupns",
			"cgroupns_mode",
			"userns_mode",
			"cap_add",
			"devices",
			"ports",
			"security_opt",
			"volumes_from",
			"volumes",
			"extra_hosts",
			"sysctls",
			"env_file",
		] as const;
		for (const key of dangerousKeys) {
			const value = service[key];
			if (value === undefined || value === null) continue;
			const serialized = typeof value === "string" ? value : JSON.stringify(value);
			if (/\$\{/.test(serialized)) {
				throw new Error(
					`Compose service "${serviceName}" must not use env interpolation in "${key}"`,
				);
			}
		}

		if (isTruthy(service.privileged)) {
			throw new Error(`Compose service "${serviceName}" must not set privileged: true`);
		}
		// Nixploy injects overlay networking — reject any custom namespace / cgroup mode.
		for (const key of [
			"network_mode",
			"pid",
			"ipc",
			"uts",
			"cgroup",
			"cgroupns",
			"cgroupns_mode",
			"userns_mode",
		] as const) {
			const value = service[key];
			if (value === undefined || value === null || value === "") continue;
			throw new Error(
				`Compose service "${serviceName}" must not set ${key} (host/shared namespaces are blocked)`,
			);
		}
		if (service.volumes_from !== undefined && service.volumes_from !== null) {
			throw new Error(`Compose service "${serviceName}" must not use volumes_from`);
		}
		if (service.security_opt !== undefined && service.security_opt !== null) {
			throw new Error(`Compose service "${serviceName}" must not set security_opt`);
		}

		const caps = service.cap_add;
		const capList = Array.isArray(caps) ? caps.map(String) : typeof caps === "string" ? [caps] : [];
		for (const cap of capList) {
			const normalized = cap.toUpperCase().replace(/^CAP_/, "");
			if (BLOCKED_CAP_ADD.has(normalized) && !allowedCaps.has(normalized)) {
				throw new Error(`Compose service "${serviceName}" must not add capability ${cap}`);
			}
		}

		if (service.devices !== undefined && service.devices !== null) {
			throw new Error(`Compose service "${serviceName}" must not mount host devices`);
		}
		if (service.device_requests !== undefined && service.device_requests !== null) {
			throw new Error(`Compose service "${serviceName}" must not set device_requests`);
		}
		if (service.gpus !== undefined && service.gpus !== null) {
			throw new Error(`Compose service "${serviceName}" must not set gpus`);
		}

		if (service.extra_hosts !== undefined && service.extra_hosts !== null) {
			throw new Error(
				`Compose service "${serviceName}" must not set extra_hosts (DNS spoofing is blocked)`,
			);
		}
		if (service.sysctls !== undefined && service.sysctls !== null && !options?.allowSysctls) {
			throw new Error(`Compose service "${serviceName}" must not set sysctls`);
		}

		if (service.ports !== undefined && service.ports !== null) {
			throw new Error(
				`Compose service "${serviceName}" must not publish host ports (use Nixploy domains / Traefik)`,
			);
		}

		for (const source of assertAndCollectVolumeSources(serviceName, service.volumes, options)) {
			const lower = source.toLowerCase();
			const isSocket = isDockerSocketSource(source);
			if (lower.includes("docker.sock") || lower.endsWith("/docker.sock")) {
				if (!(options?.allowDockerSocket && isSocket)) {
					throw new Error(`Compose service "${serviceName}" must not mount the Docker socket`);
				}
				continue;
			}
			// Host binds (absolute or relative) are forbidden — only named volumes.
			if (source.startsWith("/") || source.startsWith(".") || source.includes("..")) {
				throw new Error(
					`Compose service "${serviceName}" must not bind-mount host paths (use named volumes)`,
				);
			}
		}

		for (const [key] of labelEntries(service.labels)) {
			if (key.toLowerCase().startsWith("traefik.")) {
				throw new Error(
					`Compose service "${serviceName}" must not set Traefik labels (routing is managed by Nixploy)`,
				);
			}
		}
	}
}

/**
 * Rename every service with a suffix (isolated deployments) and rewrite
 * intra-file references (`depends_on`, `links`) to the new names.
 */
export function randomizeServiceNames(spec: ComposeFileSpec, suffix: string): ComposeFileSpec {
	if (!suffix || !spec.services) return spec;
	const renamed: Record<string, ComposeServiceSpec> = {};
	for (const [name, service] of Object.entries(spec.services)) {
		renamed[`${name}-${suffix}`] = service;
	}
	for (const service of Object.values(renamed)) {
		if (Array.isArray(service.depends_on)) {
			service.depends_on = service.depends_on.map((dep) =>
				spec.services && dep in spec.services ? `${dep}-${suffix}` : dep,
			);
		} else if (service.depends_on && typeof service.depends_on === "object") {
			const next: Record<string, unknown> = {};
			for (const [dep, condition] of Object.entries(service.depends_on)) {
				next[spec.services && dep in spec.services ? `${dep}-${suffix}` : dep] = condition;
			}
			service.depends_on = next;
		}
		if (Array.isArray(service.links)) {
			service.links = service.links.map((link) => {
				const [target, ...rest] = link.split(":");
				const resolved =
					target && spec.services && target in spec.services ? `${target}-${suffix}` : target;
				return [resolved, ...rest].join(":");
			});
		}
	}
	return { ...spec, services: renamed };
}

/**
 * Attach every service to the shared `nixploy-network` overlay network so
 * Traefik can reach it. In `docker-compose` mode each service also gets the
 * alias `<appName>-<serviceName>` — that is the hostname Traefik routes to.
 * Stack mode relies on native swarm DNS (`<appName>_<serviceName>`).
 */
export function injectNetwork(
	spec: ComposeFileSpec,
	input: { appName: string; composeType: "docker-compose" | "stack" },
): ComposeFileSpec {
	const network = getSwarmNetwork();
	const next: ComposeFileSpec = { ...spec };
	next.networks = {
		...next.networks,
		[network]: { external: true, name: network },
	};
	for (const [serviceName, service] of Object.entries(next.services ?? {})) {
		const alias = `${input.appName}-${serviceName}`;
		if (Array.isArray(service.networks)) {
			service.networks =
				input.composeType === "stack"
					? [...new Set([...service.networks, network])]
					: service.networks.filter((n) => n !== network);
			if (input.composeType === "docker-compose") {
				// convert to map form so the alias can be attached
				const asMap: Record<string, { aliases?: string[] } & Record<string, unknown>> = {};
				for (const n of service.networks) asMap[n] = {};
				asMap[network] = { aliases: [alias] };
				service.networks = asMap;
			}
		} else {
			const existing = service.networks ?? {};
			existing[network] = input.composeType === "docker-compose" ? { aliases: [alias] } : {};
			service.networks = existing;
		}
	}
	return next;
}

/** Full transform applied right before deploy: safety check + suffix + network. */
export function buildDeployComposeFile(
	content: string,
	input: { appName: string; composeType: "docker-compose" | "stack"; suffix?: string | null },
	options?: ComposeSafetyOptions,
): string {
	let spec = parseComposeFile(content);
	assertSafeComposeSpec(spec, options);
	if (input.suffix) {
		spec = randomizeServiceNames(spec, input.suffix);
	}
	spec = injectNetwork(spec, { appName: input.appName, composeType: input.composeType });
	return stringify(spec);
}

/**
 * Merge `KEY=VALUE` env files, later sources overriding earlier ones
 * (project → environment → service). Comments and blank lines are dropped.
 */
export function mergeEnvVars(...sources: Array<string | null | undefined>): string {
	const byKey = new Map<string, string>();
	for (const source of sources) {
		if (!source) continue;
		for (const line of source.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;
			byKey.set(trimmed.slice(0, eq).trim(), trimmed);
		}
	}
	return [...byKey.values()].join("\n");
}
