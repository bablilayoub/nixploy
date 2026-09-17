import { badRequest } from "../errors";
import { parseBuildBlock } from "./build";
import { type ComposeFileSpec, type ComposeServiceSpec, ComposeValidationError } from "./parse";

/**
 * Compose safety policy: what a tenant file may not do (host escapes, shared
 * networks, unbounded limits, Traefik label hijack) and the baseline container
 * hardening injected into every rendered service afterwards.
 */

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

/* ── container hardening (compose shape) ─────────────────────────────────── */

/**
 * Compose-shaped mirror of the swarm hardening defaults in
 * `deployment/swarm.ts` — injected by {@link applyComposeHardening} into
 * every rendered service that does not set the key itself. Kept as literal
 * YAML keys here so this module stays free of dockerode/db imports.
 */
export const COMPOSE_CAP_DROP: readonly string[] = ["ALL"];
export const COMPOSE_CAP_ADD: readonly string[] = [
	"CHOWN",
	"DAC_OVERRIDE",
	"FOWNER",
	"KILL",
	"NET_BIND_SERVICE",
	"SETGID",
	"SETUID",
];
export const COMPOSE_SECURITY_OPT: readonly string[] = ["no-new-privileges:true"];
export const COMPOSE_PIDS_LIMIT = 1024;
export const COMPOSE_NOFILE_ULIMIT = 65536;
export const COMPOSE_LOGGING = {
	driver: "json-file",
	options: { "max-size": "10m", "max-file": "3" },
} as const;

/** Ceilings a tenant file may not raise past (the defaults are much lower). */
const MAX_PIDS_LIMIT = 4096;
const MAX_NOFILE_ULIMIT = 1_000_000;
const MAX_TMPFS_BYTES = 1024 ** 3;

/** Log drivers that keep `docker compose logs` (and the panel viewer) working. */
const ALLOWED_LOG_DRIVERS = new Set(["json-file", "local"]);

export interface ComposeSafetyOptions {
	/** Allow bind-mount of the Docker engine socket only (exact host paths). */
	allowDockerSocket?: boolean;
	/** Capability names (without `CAP_` prefix) permitted despite the denylist. */
	allowCapabilities?: ReadonlySet<string> | readonly string[];
	/** Allow `sysctls` (needed for VPN templates like wg-easy). */
	allowSysctls?: boolean;
	/**
	 * Allow `build:` blocks (validated by `./build.ts`, then built by Nixploy
	 * and replaced with `image:` before deploy). Off by default: a stack that
	 * has not opted in must not be able to make compose read a host path.
	 */
	allowBuild?: boolean;
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

/** Parse a docker size suffix (`64m`, `1g`, `512k`, plain bytes) into bytes. */
function parseSizeBytes(value: string): number | null {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)b?\s*$/i.exec(value);
	if (!match?.[1]) return null;
	const unit = (match[2] ?? "").toLowerCase();
	const multiplier =
		unit === "k"
			? 1024
			: unit === "m"
				? 1024 ** 2
				: unit === "g"
					? 1024 ** 3
					: unit === "t"
						? 1024 ** 4
						: 1;
	return Math.floor(Number.parseFloat(match[1]) * multiplier);
}

/**
 * Service-level `tmpfs:` is RAM. Without an explicit `size=` docker lets the
 * mount grow to half the host's memory, which is a one-line memory DoS for
 * every other tenant on the node — so a bounded `size=` is mandatory.
 * (Long-form `type: tmpfs` volumes are rejected outright elsewhere.)
 */
function assertSafeTmpfs(serviceName: string, tmpfs: unknown): void {
	if (tmpfs === undefined || tmpfs === null) return;
	const entries = Array.isArray(tmpfs) ? tmpfs.map(String) : [String(tmpfs)];
	for (const entry of entries) {
		// Short syntax is `/path:opt1,opt2`, so the first option follows a colon.
		const size = /[:,]\s*size=([^,]+)/i.exec(entry)?.[1];
		if (!size) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must give every tmpfs an explicit size= (max 1g): "${entry}"`,
			);
		}
		const bytes = parseSizeBytes(size);
		if (bytes === null || bytes > MAX_TMPFS_BYTES) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not mount a tmpfs larger than 1g: "${entry}"`,
			);
		}
	}
}

/**
 * A foreign log driver (`syslog`, `gelf`, `fluentd`, `awslogs`, …) ships the
 * stack's output to an arbitrary endpoint and breaks `docker compose logs`
 * (and therefore the panel's log viewer).
 */
function assertSafeLogging(serviceName: string, logging: unknown): void {
	if (!logging || typeof logging !== "object" || Array.isArray(logging)) return;
	const driver = (logging as Record<string, unknown>).driver;
	if (driver === undefined || driver === null) return;
	if (!ALLOWED_LOG_DRIVERS.has(String(driver).trim().toLowerCase())) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}" must not use logging driver ${String(driver)} (json-file/local only)`,
		);
	}
}

/** Fork-bomb ceiling: the injected default is 1024, tenants may raise it to 4096. */
function assertSafePidsLimit(serviceName: string, value: unknown): void {
	if (value === undefined || value === null) return;
	const limit = Number(value);
	if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_PIDS_LIMIT) {
		throw new ComposeValidationError(
			`Compose service "${serviceName}" must keep pids_limit between 1 and ${MAX_PIDS_LIMIT}`,
		);
	}
}

/** `nofile` above ~1M exhausts the host's file-descriptor tables. */
function assertSafeUlimits(serviceName: string, ulimits: unknown): void {
	if (!ulimits || typeof ulimits !== "object" || Array.isArray(ulimits)) return;
	for (const [name, value] of Object.entries(ulimits as Record<string, unknown>)) {
		const numbers =
			value && typeof value === "object" && !Array.isArray(value)
				? Object.values(value as Record<string, unknown>).map(Number)
				: [Number(value)];
		for (const entry of numbers) {
			if (!Number.isFinite(entry) || entry < 0) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}" has an invalid ulimit "${name}"`,
				);
			}
			if (name.toLowerCase() === "nofile" && entry > MAX_NOFILE_ULIMIT) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}" must keep the nofile ulimit at or below ${MAX_NOFILE_ULIMIT}`,
				);
			}
		}
	}
}

/**
 * `deploy.mode: global` puts a task on *every* node of the swarm, and a
 * `node.role == manager` constraint targets the nodes that hold the panel,
 * Postgres and the docker socket. Nixploy pins tasks by `node.id` instead
 * (see `injectNodeConstraint`), which runs after this check.
 */
function assertSafeDeploy(serviceName: string, deploy: unknown): void {
	if (!deploy || typeof deploy !== "object" || Array.isArray(deploy)) return;
	const record = deploy as Record<string, unknown>;
	if (typeof record.mode === "string" && record.mode.trim().toLowerCase() === "global") {
		throw new ComposeValidationError(
			`Compose service "${serviceName}" must not use deploy.mode: global (it would run on every node)`,
		);
	}
	const placement = record.placement;
	if (!placement || typeof placement !== "object" || Array.isArray(placement)) return;
	const constraints = (placement as Record<string, unknown>).constraints;
	const list = Array.isArray(constraints) ? constraints.map(String) : [];
	for (const constraint of list) {
		if (/node\.role\s*(==|!=)\s*manager/i.test(constraint)) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not target manager nodes in deploy.placement.constraints`,
			);
		}
	}
}

/**
 * Reject compose features that escape the container into the Nixploy host
 * (docker.sock, privileged, host namespaces, dangerous caps, Traefik label hijack).
 *
 * Run it on the raw spec (early feedback) AND on the env-rendered spec from
 * `renderComposeSpec` — the rendered one is what Docker executes.
 *
 * `options` is only for instance-admin host-privileged templates / rows — still
 * blocks privileged mode, host namespaces, arbitrary binds, and Traefik labels.
 */
export function assertSafeComposeSpec(spec: ComposeFileSpec, options?: ComposeSafetyOptions): void {
	if (spec.include !== undefined && spec.include !== null) {
		throw badRequest('Compose "include" is not allowed');
	}
	if (spec.extends !== undefined && spec.extends !== null) {
		throw badRequest('Compose top-level "extends" is not allowed');
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
			if (!options?.allowBuild) {
				throw new ComposeValidationError(
					`Compose service "${serviceName}" must not use build: (enable "Build services from source" on the stack to allow it)`,
				);
			}
			// Validates the block's shape and refuses every escape hatch
			// (dockerfile_inline, ssh, remote contexts, `..` paths).
			parseBuildBlock(serviceName, service.build);
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
			"cgroup_parent",
			"tmpfs",
			"pids_limit",
			"ulimits",
			"logging",
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
		// `cgroup_parent` moves the container into an operator-owned cgroup and
		// escapes every limit Nixploy sets (`cgroup`/`cgroupns` are blocked above).
		if (service.cgroup_parent !== undefined && service.cgroup_parent !== null) {
			throw new ComposeValidationError(
				`Compose service "${serviceName}" must not set cgroup_parent`,
			);
		}
		assertSafeTmpfs(serviceName, service.tmpfs);
		assertSafeLogging(serviceName, service.logging);
		assertSafePidsLimit(serviceName, service.pids_limit);
		assertSafeUlimits(serviceName, service.ulimits);
		assertSafeDeploy(serviceName, service.deploy);

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

/**
 * Baseline container hardening for every rendered compose service, applied
 * after the safety checks so it can never be interpolated away.
 *
 * Keys the file already sets win — the deny-list above has already bounded
 * them (`pids_limit` ≤ 4096, `nofile` ≤ 1M, json-file/local logging, no
 * `security_opt`, no dangerous `cap_add`) — so this only fills the blanks.
 * `cap_drop: [ALL]` is always written and the minimal add-set is merged on
 * top of whatever the file asked for.
 *
 * `docker stack deploy` (swarm) honours `cap_add`/`cap_drop` and `logging`
 * but silently ignores `security_opt`, `pids_limit` and `ulimits`, so those
 * three are only injected for the `docker-compose` runtime; swarm stacks get
 * the same protection through the platform's own service specs where
 * Nixploy owns them.
 */
export function applyComposeHardening(
	spec: ComposeFileSpec,
	composeType: "docker-compose" | "stack" = "docker-compose",
): ComposeFileSpec {
	const services: Record<string, ComposeServiceSpec> = {};
	for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
		const next: ComposeServiceSpec = { ...service };

		const declared = Array.isArray(service.cap_add)
			? service.cap_add.map((cap) => String(cap).toUpperCase().replace(/^CAP_/, ""))
			: typeof service.cap_add === "string"
				? [String(service.cap_add).toUpperCase().replace(/^CAP_/, "")]
				: [];
		next.cap_add = [...new Set([...COMPOSE_CAP_ADD, ...declared])];
		next.cap_drop = [...COMPOSE_CAP_DROP];

		if (next.logging === undefined || next.logging === null) {
			next.logging = { driver: COMPOSE_LOGGING.driver, options: { ...COMPOSE_LOGGING.options } };
		}

		if (composeType === "docker-compose") {
			next.security_opt = [...COMPOSE_SECURITY_OPT];
			if (next.pids_limit === undefined || next.pids_limit === null) {
				next.pids_limit = COMPOSE_PIDS_LIMIT;
			}
			if (next.ulimits === undefined || next.ulimits === null) {
				next.ulimits = { nofile: { soft: COMPOSE_NOFILE_ULIMIT, hard: COMPOSE_NOFILE_ULIMIT } };
			}
		}

		services[serviceName] = next;
	}
	return { ...spec, services };
}
