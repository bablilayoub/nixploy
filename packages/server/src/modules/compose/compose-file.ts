import { parse, stringify } from "yaml";
import { getSwarmNetwork } from "../application/paths";
import { mergeNodeConstraint } from "../cluster/placement";
import { parseEnv } from "../deployment/env";

/**
 * A compose file the platform refuses to run (privileged services, host
 * binds, interpolation into dangerous keys, …). Routers map it to
 * BAD_REQUEST; the deploy worker logs it as the deployment error.
 */
export class ComposeValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ComposeValidationError";
	}
}

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

/** Interpolation variables: the merged project → environment → service env. */
export type ComposeEnv = Readonly<Record<string, string>>;

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

// ── env interpolation ───────────────────────────────────────────────────────

const VAR_NAME_RE = /^[_a-zA-Z][_a-zA-Z0-9]*/;

/**
 * Expand one string the way compose does (compose-go template grammar):
 * `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `${VAR:?err}`,
 * `${VAR?err}`, `${VAR:+alt}`, `${VAR+alt}`, nested `${A:-${B}}`, and `$$`
 * as a literal dollar. Unknown variables expand to the empty string, exactly
 * like `docker compose` does when a variable is unset.
 */
export function interpolateComposeString(input: string, env: ComposeEnv): string {
	let out = "";
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (ch !== "$") {
			out += ch;
			i += 1;
			continue;
		}
		const next = input[i + 1];
		if (next === "$") {
			out += "$";
			i += 2;
			continue;
		}
		if (next === "{") {
			let depth = 1;
			let j = i + 2;
			while (j < input.length && depth > 0) {
				if (input[j] === "{") depth += 1;
				else if (input[j] === "}") depth -= 1;
				if (depth > 0) j += 1;
			}
			if (depth !== 0) {
				throw new Error(`Invalid compose interpolation (unterminated \${): "${input}"`);
			}
			out += expandBraced(input.slice(i + 2, j), env, input);
			i = j + 1;
			continue;
		}
		const named = VAR_NAME_RE.exec(input.slice(i + 1));
		if (named) {
			out += env[named[0]] ?? "";
			i += 1 + named[0].length;
			continue;
		}
		// A `$` followed by anything else is not a template — keep it.
		out += "$";
		i += 1;
	}
	return out;
}

function expandBraced(inner: string, env: ComposeEnv, whole: string): string {
	const named = VAR_NAME_RE.exec(inner);
	if (!named) {
		throw new Error(`Invalid compose interpolation format: "${whole}"`);
	}
	const name = named[0];
	const rest = inner.slice(name.length);
	const value = env[name];
	if (rest === "") return value ?? "";
	const two = rest.slice(0, 2);
	const one = rest.slice(0, 1);
	const op =
		two === ":-" || two === ":?" || two === ":+"
			? two
			: one === "-" || one === "?" || one === "+"
				? one
				: null;
	if (!op) {
		throw new Error(`Invalid compose interpolation format: "${whole}"`);
	}
	const arg = rest.slice(op.length);
	// `:` variants treat an empty value like an unset one.
	const missing = op.startsWith(":") ? value === undefined || value === "" : value === undefined;
	switch (op) {
		case ":-":
		case "-":
			return missing ? interpolateComposeString(arg, env) : (value as string);
		case ":?":
		case "?":
			if (!missing) return value as string;
			throw new Error(
				`Required compose variable ${name} is missing a value: ${interpolateComposeString(arg, env)}`,
			);
		default:
			return missing ? "" : interpolateComposeString(arg, env);
	}
}

function mapStrings(value: unknown, fn: (text: string) => string): unknown {
	if (typeof value === "string") return fn(value);
	if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fn));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			out[key] = mapStrings(entry, fn);
		}
		return out;
	}
	return value;
}

/**
 * Resolve `environment` entries without a value (`- KEY` / `KEY:` null) from
 * the merged env, dropping the ones it does not define. Compose would fall
 * back to the *panel's* process environment for those — never allow that.
 */
function resolveBareEnvironment(environment: unknown, env: ComposeEnv): unknown {
	if (Array.isArray(environment)) {
		const out: unknown[] = [];
		for (const entry of environment) {
			if (typeof entry !== "string" || entry.includes("=")) {
				out.push(entry);
				continue;
			}
			const key = entry.trim();
			if (key in env) out.push(`${key}=${env[key]}`);
		}
		return out;
	}
	if (environment && typeof environment === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(environment as Record<string, unknown>)) {
			if (value === null || value === undefined) {
				if (key in env) out[key] = env[key];
				continue;
			}
			out[key] = value;
		}
		return out;
	}
	return environment;
}

/**
 * Interpolate every string of the parsed spec with the merged env — this is
 * the spec Docker will actually run, so it is what the safety check must see.
 * Returns a deep copy; the input is left untouched.
 */
export function renderComposeSpec(spec: ComposeFileSpec, env: ComposeEnv): ComposeFileSpec {
	const rendered = mapStrings(spec, (text) =>
		interpolateComposeString(text, env),
	) as ComposeFileSpec;
	for (const service of Object.values(rendered.services ?? {})) {
		if (service.environment !== undefined) {
			service.environment = resolveBareEnvironment(service.environment, env);
		}
	}
	return rendered;
}

/**
 * Escape every `$` as `$$` so the already-rendered file survives Docker's own
 * interpolation pass unchanged (compose and the stack loader both un-escape
 * `$$`). Nothing in the deployed file is ever resolved from the host env.
 */
export function escapeComposeInterpolation(spec: ComposeFileSpec): ComposeFileSpec {
	// Function replacer: a "$$" replacement string would itself mean a literal "$".
	return mapStrings(spec, (text) => text.replaceAll("$", () => "$$")) as ComposeFileSpec;
}

/**
 * Value the container should see for one `KEY=VALUE` env line. Surrounding
 * matching quotes are stripped (what `docker compose --env-file` used to do
 * for these files); nothing else is interpreted.
 */
function unquoteEnvValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

/** Merged `KEY=VALUE` lines → interpolation map. */
export function composeEnvMap(mergedEnv: string | null | undefined): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of parseEnv(mergedEnv)) env[key] = unquoteEnvValue(value);
	return env;
}

/**
 * Whether an env value is worth registering as a log secret. Short tokens
 * (`DEBUG=1`, `POSTGRES_USER=postgres`, ports, booleans) would redact every
 * occurrence of "1" / "postgres" in the deploy log and make it unreadable.
 */
export function shouldRedactEnvValue(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length < 8) return false;
	if (/^\d+$/.test(trimmed)) return false;
	if (/^(true|false|yes|no|on|off|null|undefined)$/i.test(trimmed)) return false;
	return true;
}

// ── safety ──────────────────────────────────────────────────────────────────

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

/** Network drivers a tenant file may declare (everything else reaches the host / LAN). */
const ALLOWED_NETWORK_DRIVERS = new Set(["bridge", "overlay"]);

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

function isExternal(record: Record<string, unknown>): boolean {
	return (
		record.external === true ||
		typeof record.external === "string" ||
		(typeof record.external === "object" && record.external !== null)
	);
}

function hasName(record: Record<string, unknown>): boolean {
	const name = record.name ?? record.Name;
	return typeof name === "string" && name.trim() !== "";
}

/** Collect volume sources; rejects long-form bind/tmpfs and non-array shapes. */
function assertAndCollectVolumeSources(
	serviceName: string,
	volumes: unknown,
	options?: ComposeSafetyOptions,
): string[] {
	if (volumes === undefined || volumes === null) return [];
	if (!Array.isArray(volumes)) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}" volumes must be an array of mounts`,
		);
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
				throw new ComposeValidationError(
					`Compose service "${serviceName}" must not use volumes type: ${type} (named volumes only)`,
				);
			}
			if (type === "bind") {
				if (!(options?.allowDockerSocket && isDockerSocketSource(source))) {
					throw new ComposeValidationError(
						`Compose service "${serviceName}" must not use volumes type: bind (named volumes only)`,
					);
				}
			}
			if (source) sources.push(source);
			continue;
		}
		throw new ComposeValidationError(
			`Compose service "${serviceName}" has an invalid volumes entry`,
		);
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
		if (isExternal(record)) {
			throw new ComposeValidationError(
				`Compose volume "${name}" must not use external: (attaching host volumes is blocked)`,
			);
		}
		// `name:` bypasses the `<appName>_` scoping and mounts any volume on the
		// node — another tenant's `<app>_data` or the platform's own Postgres.
		if (hasName(record)) {
			throw new ComposeValidationError(
				`Compose volume "${name}" must not set name: (volume names are scoped to this service)`,
			);
		}
		const opts = record.driver_opts;
		if (!opts || typeof opts !== "object" || Array.isArray(opts)) continue;
		const map = opts as Record<string, unknown>;
		const type = String(map.type ?? map.Type ?? "").toLowerCase();
		const o = String(map.o ?? map.options ?? "").toLowerCase();
		const device = String(map.device ?? map.Device ?? "");
		if (type === "none" || o.includes("bind") || device.startsWith("/") || device.startsWith(".")) {
			throw new ComposeValidationError(
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
			throw new ComposeValidationError(
				`Compose ${kind} "${name}" must not use file: (host path reads are blocked)`,
			);
		}
		const environment = record.environment ?? record.Environment;
		if (typeof environment === "string" && environment.trim()) {
			throw new ComposeValidationError(
				`Compose ${kind} "${name}" must not use environment: (host env reads are blocked)`,
			);
		}
		if (isExternal(record)) {
			throw new ComposeValidationError(
				`Compose ${kind} "${name}" must not use external: (cross-stack attach is blocked)`,
			);
		}
		if (hasName(record)) {
			throw new ComposeValidationError(
				`Compose ${kind} "${name}" must not set name: (names are scoped to this service)`,
			);
		}
	}
}

/**
 * Tenant-declared networks stay private to the project: no `external:` /
 * `name:` (would attach to the shared overlay or another tenant's network)
 * and only bridge/overlay drivers (macvlan/ipvlan put containers on the LAN).
 */
function assertSafeNetworks(networks: unknown): void {
	if (networks === undefined || networks === null) return;
	if (typeof networks !== "object" || Array.isArray(networks)) {
		throw new ComposeValidationError("Compose top-level networks must be a mapping");
	}
	for (const [name, def] of Object.entries(networks as Record<string, unknown>)) {
		if (def === null || def === undefined) continue;
		if (typeof def !== "object" || Array.isArray(def)) continue;
		const record = def as Record<string, unknown>;
		if (isExternal(record)) {
			throw new ComposeValidationError(
				`Compose network "${name}" must not use external: (networking is managed by Nixploy)`,
			);
		}
		if (hasName(record)) {
			throw new ComposeValidationError(
				`Compose network "${name}" must not set name: (network names are scoped to this service)`,
			);
		}
		const driver = record.driver ?? record.Driver;
		if (
			driver !== undefined &&
			driver !== null &&
			!ALLOWED_NETWORK_DRIVERS.has(String(driver).trim().toLowerCase())
		) {
			throw new ComposeValidationError(
				`Compose network "${name}" must not use driver ${String(driver)} (bridge/overlay only)`,
			);
		}
	}
}

/**
 * Reject compose features that escape the container into the Nixploy host
 * (docker.sock, privileged, host namespaces, dangerous caps, Traefik label hijack).
 *
 * Run it on the raw spec (early feedback) AND on the env-rendered spec from
 * {@link renderComposeSpec} — the rendered one is what Docker executes.
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
	assertSafeNetworks(spec.networks);

	const allowedCaps = allowedCapSet(options);

	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		if (service.extends !== undefined && service.extends !== null) {
			throw new ComposeValidationError(`Compose service "${serviceName}" must not use extends`);
		}
		if (service.build !== undefined && service.build !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not use build: (host context / dockerfile_inline reads are blocked)`,
			);
		}
		if (service.env_file !== undefined && service.env_file !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not use env_file: (host path reads are blocked)`,
			);
		}

		// Dangerous fields must be literal: no `$VAR` / `${VAR}` that only the
		// merged env decides at deploy time (the rendered spec is checked too).
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
			if (serialized.includes("$")) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}" must not use env interpolation in "${key}"`,
				);
			}
		}

		if (isTruthy(service.privileged)) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not set privileged: true`,
			);
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
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not set ${key} (host/shared namespaces are blocked)`,
			);
		}
		if (service.volumes_from !== undefined && service.volumes_from !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not use volumes_from`,
			);
		}
		if (service.security_opt !== undefined && service.security_opt !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not set security_opt`,
			);
		}

		const caps = service.cap_add;
		const capList = Array.isArray(caps) ? caps.map(String) : typeof caps === "string" ? [caps] : [];
		for (const cap of capList) {
			const normalized = cap.toUpperCase().replace(/^CAP_/, "");
			if (BLOCKED_CAP_ADD.has(normalized) && !allowedCaps.has(normalized)) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}" must not add capability ${cap}`,
				);
			}
		}

		if (service.devices !== undefined && service.devices !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not mount host devices`,
			);
		}
		if (service.device_requests !== undefined && service.device_requests !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not set device_requests`,
			);
		}
		if (service.gpus !== undefined && service.gpus !== null) {
			throw new ComposeValidationError(`Compose service "${serviceName}" must not set gpus`);
		}

		if (service.extra_hosts !== undefined && service.extra_hosts !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not set extra_hosts (DNS spoofing is blocked)`,
			);
		}
		if (service.sysctls !== undefined && service.sysctls !== null && !options?.allowSysctls) {
			throw new ComposeValidationError(`Compose service "${serviceName}" must not set sysctls`);
		}

		if (service.ports !== undefined && service.ports !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not publish host ports (use Nixploy domains / Traefik)`,
			);
		}

		for (const source of assertAndCollectVolumeSources(serviceName, service.volumes, options)) {
			const lower = source.toLowerCase();
			const isSocket = isDockerSocketSource(source);
			if (lower.includes("docker.sock") || lower.endsWith("/docker.sock")) {
				if (!(options?.allowDockerSocket && isSocket)) {
					throw new ComposeValidationError(
						`Compose service "${serviceName}" must not mount the Docker socket`,
					);
				}
				continue;
			}
			// Host binds are forbidden — only named volumes. `~` expands to the
			// host home and `$` can only be a leftover template.
			if (
				source.startsWith("/") ||
				source.startsWith(".") ||
				source.startsWith("~") ||
				source.startsWith("$") ||
				source.includes("..")
			) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}" must not bind-mount host paths (use named volumes)`,
				);
			}
		}

		for (const [key] of labelEntries(service.labels)) {
			if (key.toLowerCase().startsWith("traefik.")) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}" must not set Traefik labels (routing is managed by Nixploy)`,
				);
			}
		}
	}
}

// ── deploy transforms ───────────────────────────────────────────────────────

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

/** Name of the private per-app network every service of `appName` joins. */
export const privateNetworkName = (appName: string) => `${appName}-net`;

function toNetworkMap(
	networks: ComposeServiceSpec["networks"],
): Record<string, { aliases?: string[] } & Record<string, unknown>> {
	const map: Record<string, { aliases?: string[] } & Record<string, unknown>> = {};
	if (Array.isArray(networks)) {
		for (const name of networks) map[String(name)] = {};
		return map;
	}
	if (networks && typeof networks === "object") {
		for (const [name, config] of Object.entries(networks)) {
			map[name] = config && typeof config === "object" ? { ...config } : {};
		}
	}
	return map;
}

/**
 * Networking for a deploy:
 * - every service joins a private per-app network (`<appName>-net`) so bare
 *   service names (`db`, `redis`) only resolve inside this stack — on the
 *   shared overlay they would round-robin across tenants;
 * - only `exposedServices` (the Traefik targets) also join `nixploy-network`,
 *   with the alias `<appName>-<serviceName>` Traefik routes to. Any tenant
 *   reference to the shared network is dropped first.
 */
export function injectNetwork(
	spec: ComposeFileSpec,
	input: {
		appName: string;
		composeType: "docker-compose" | "stack";
		exposedServices?: Iterable<string>;
	},
): ComposeFileSpec {
	const shared = getSwarmNetwork();
	const privateNet = privateNetworkName(input.appName);
	const exposed = new Set(input.exposedServices ?? []);

	const networks: Record<string, unknown> =
		spec.networks && typeof spec.networks === "object" && !Array.isArray(spec.networks)
			? { ...spec.networks }
			: {};
	networks[privateNet] =
		input.composeType === "stack"
			? { name: privateNet, driver: "overlay", attachable: true }
			: { name: privateNet };
	if (exposed.size > 0) {
		networks[shared] = { external: true, name: shared };
	} else {
		delete networks[shared];
	}

	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		const attached = toNetworkMap(service.networks);
		delete attached[shared];
		attached[privateNet] = {};
		if (exposed.has(serviceName)) {
			attached[shared] = { aliases: [`${input.appName}-${serviceName}`] };
		}
		services[serviceName] = { ...service, networks: attached };
	}
	return { ...spec, networks, services };
}

/**
 * `docker stack deploy` uses the v3 stack loader: it rejects top-level `name:`
 * and long-form `depends_on`. Both are meaningless for swarm — drop / flatten.
 */
function normalizeForStack(spec: ComposeFileSpec): ComposeFileSpec {
	const { name: _name, ...rest } = spec;
	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(rest.services ?? {})) {
		const next = { ...service };
		if (next.depends_on && !Array.isArray(next.depends_on) && typeof next.depends_on === "object") {
			next.depends_on = Object.keys(next.depends_on);
		}
		services[serviceName] = next;
	}
	return { ...rest, services };
}

/**
 * Stack mode, row pinned to a managed server: `docker stack deploy` runs on
 * the PRIMARY manager (see compose/source.ts), so every service gets
 * `deploy.placement.constraints: ["node.id==<swarmNodeId>"]` to land its
 * tasks — and their `<appName>_*` named volumes — on the pinned server. The
 * user's other constraints are kept; a foreign `node.id==` pin is replaced.
 *
 * Limitation: `docker stack deploy` never builds (it ignores `build:`, which
 * the safety check rejects anyway), so stack services on a remote must use
 * images the pinned node can pull from a registry.
 */
export function injectNodeConstraint(
	spec: ComposeFileSpec,
	swarmNodeId: string | null | undefined,
): ComposeFileSpec {
	if (!swarmNodeId) return spec;
	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		const deploy =
			service.deploy && typeof service.deploy === "object" && !Array.isArray(service.deploy)
				? (service.deploy as Record<string, unknown>)
				: {};
		const placement =
			deploy.placement && typeof deploy.placement === "object" && !Array.isArray(deploy.placement)
				? (deploy.placement as Record<string, unknown>)
				: {};
		const constraints = Array.isArray(placement.constraints) ? placement.constraints : [];
		services[serviceName] = {
			...service,
			deploy: {
				...deploy,
				placement: {
					...placement,
					constraints: mergeNodeConstraint(constraints, swarmNodeId),
				},
			},
		};
	}
	return { ...spec, services };
}

export interface DeployComposeInput {
	appName: string;
	composeType: "docker-compose" | "stack";
	/** Isolation suffix applied to every service name (empty/null = none). */
	suffix?: string | null;
	/** Merged project → environment → service env, rendered into the file. */
	env?: ComposeEnv;
	/** Source service names (before the suffix) that have a Nixploy domain. */
	exposedServices?: Iterable<string>;
	/**
	 * Stack mode only: primary-swarm node id of the server the row is pinned
	 * to (`getServerSwarmNodeId`); every service is placed on it.
	 */
	swarmNodeId?: string | null;
}

/**
 * Full transform applied right before deploy: safety check on the raw spec,
 * env interpolation, safety check on the rendered spec, suffix, networking.
 * The output contains no live templates (`$` is escaped), so Docker never
 * resolves anything from the host environment.
 */
export function buildDeployComposeFile(
	content: string,
	input: DeployComposeInput,
	options?: ComposeSafetyOptions,
): string {
	const raw = parseComposeFile(content);
	assertSafeComposeSpec(raw, options);
	let spec = renderComposeSpec(raw, input.env ?? {});
	assertSafeComposeSpec(spec, options);

	const suffix = input.suffix || "";
	if (suffix) {
		spec = randomizeServiceNames(spec, suffix);
	}
	const exposedServices = [...(input.exposedServices ?? [])].map((name) =>
		suffix ? `${name}-${suffix}` : name,
	);
	spec = injectNetwork(spec, {
		appName: input.appName,
		composeType: input.composeType,
		exposedServices,
	});
	if (input.composeType === "stack") {
		spec = injectNodeConstraint(normalizeForStack(spec), input.swarmNodeId);
	}
	return stringify(escapeComposeInterpolation(spec));
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
