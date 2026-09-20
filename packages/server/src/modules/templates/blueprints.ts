import { randomBytes, randomInt } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { categoryFromTags } from "./categories";
import { signJwtHs256 } from "./placeholders";
import { parseToml, type TomlTable, type TomlValue } from "./toml";
import type { Template } from "./types";

/**
 * Translate one blueprint of the Dokploy templates repository
 * (`blueprints/<id>/{meta.json,template.toml,docker-compose.yml}`) into the
 * `Template` shape this catalog deploys. Pure: no I/O, no randomness that
 * matters (the two helpers that pick a port or a username are resolved here
 * because they are not secrets; every secret becomes a deploy-time
 * placeholder so two deploys never share one).
 *
 * Their file conventions and how each lands here:
 *
 * - `[variables]` with `${helper}` values → `{{generate…:name}}` placeholders
 *   named after the variable, so a value used by several env keys is
 *   generated once per deploy (see placeholders.ts). `${domain}` → `{{domain}}`.
 * - `[config.env]` (table) or `env = ["K=V"]` (array) → the env schema, with
 *   variable references substituted.
 * - `[[config.domains]]` → the first entry is the suggested domain.
 * - `[[config.mounts]]` (`filePath` + `content`, mounted by the compose file
 *   as `../files/<filePath>`) → an inline compose `configs:` entry, and the
 *   volume line that referenced the file becomes a `configs:` attachment.
 *   Compose safety here refuses host-path reads, and an inline config is the
 *   same bytes without the host path.
 * - `env_file: - .env` on a service → dropped, and the service gets every
 *   template key as `KEY: ${KEY}` instead; that is what the file did.
 *
 * Anything that cannot be carried is a thrown {@link BlueprintError} with the
 * reason, so the sync drops that one template and keeps the rest.
 */

export class BlueprintError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BlueprintError";
	}
}

export interface BlueprintInput {
	id: string;
	/** Parsed `meta.json`. */
	meta: unknown;
	toml: string;
	compose: string;
	/** Absolute URL of a file inside the blueprint folder (the logo). */
	assetUrl: (file: string) => string;
}

export interface MappedBlueprint {
	template: Template;
	/** Things the operator should know before deploying; not failures. */
	notes: string[];
}

const metaSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().min(1).max(120),
		description: z.string().max(1024).optional(),
		version: z.string().max(64).optional(),
		logo: z.string().max(512).optional(),
		links: z
			.object({
				github: z.string().optional(),
				website: z.string().optional(),
				docs: z.string().optional(),
			})
			.partial()
			.optional(),
		tags: z.array(z.string().min(1).max(48)).optional(),
	})
	.passthrough();

const HELPER_RE = /\$\{([^}]+)\}/g;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HELPER_KINDS = new Set([
	"domain",
	"password",
	"base64",
	"hash",
	"uuid",
	"randomPort",
	"timestamp",
	"timestampms",
	"timestamps",
	"username",
	"email",
	"jwt",
]);

/** `${password:16}` is the helper even when a variable is called `password` — as in the source's engine. */
const isHelper = (inner: string): boolean => {
	const colon = inner.indexOf(":");
	return HELPER_KINDS.has(colon === -1 ? inner : inner.slice(0, colon));
};

const asString = (value: TomlValue | undefined): string | undefined =>
	typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

const tableOf = (value: TomlValue | undefined): TomlTable | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? value : undefined;

const arrayOf = (value: TomlValue | undefined): TomlValue[] => (Array.isArray(value) ? value : []);

const numberArg = (raw: string | undefined, fallback: number): number => {
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 512) : fallback;
};

const WORDS = {
	adjectives: ["cool", "smart", "fast", "quick", "super", "mega"],
	nouns: ["user", "admin", "dev", "test", "demo", "guest"],
} as const;

const syncTimeUsername = (): string =>
	`${WORDS.adjectives[randomInt(WORDS.adjectives.length)]}${WORDS.nouns[randomInt(WORDS.nouns.length)]}${randomInt(1000)}`;

/**
 * One `${helper}` occurrence → what it becomes in an env default. Secrets
 * become named deploy-time placeholders; the rest are resolved now.
 */
function mapHelper(
	helper: string,
	name: string,
	variables: ReadonlyMap<string, MappedVariable>,
): string {
	// Only the first colon separates the helper from its argument: a
	// timestamp argument is an ISO date with colons of its own.
	const colon = helper.indexOf(":");
	const kind = colon === -1 ? helper : helper.slice(0, colon);
	const argument = colon === -1 ? "" : helper.slice(colon + 1);
	const rest = argument === "" ? [] : kind === "jwt" ? argument.split(":") : [argument];
	switch (kind) {
		case "domain":
			return "{{domain}}";
		case "password":
			return `{{generatePassword:${numberArg(rest[0], 16)}:${name}}}`;
		case "base64":
			return `{{generateBase64:${numberArg(rest[0], 32)}:${name}}}`;
		case "hash":
			return `{{generateHash:${numberArg(rest[0], 8)}:${name}}}`;
		case "uuid":
			return `{{generateUuid:${name}}}`;
		case "randomPort":
			return String(randomInt(20000, 60000));
		case "timestamp":
		case "timestampms":
			return String(rest[0] ? new Date(rest[0]).getTime() : Date.now());
		case "timestamps":
			return String(Math.round((rest[0] ? new Date(rest[0]).getTime() : Date.now()) / 1000));
		case "username":
			return syncTimeUsername();
		case "email":
			return `${syncTimeUsername()}@example.com`;
		case "jwt": {
			// `jwt:<bytes>`: a random hex string, nothing to sign.
			if (rest.length === 1 && rest[0] && /^\d{1,3}$/.test(rest[0])) {
				return `{{generateHash:${numberArg(rest[0], 32) * 2}:${name}}}`;
			}
			const [secretName, payloadName] = rest;
			const secret = secretName ? variables.get(secretName) : undefined;
			const payloadSource = payloadName ? variables.get(payloadName) : undefined;
			let payload: Record<string, unknown> = {};
			if (payloadSource) {
				if (payloadSource.generated) {
					throw new BlueprintError(`jwt payload "${payloadName}" must be a literal`);
				}
				try {
					const parsed = JSON.parse(payloadSource.value);
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
				} catch {
					throw new BlueprintError(`jwt payload "${payloadName}" is not JSON`);
				}
			}
			if (!secret) {
				throw new BlueprintError(`jwt helper references unknown variable "${secretName ?? ""}"`);
			}
			if (secret.generated) {
				const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
				return `{{generateJwt:${secretName}:${encoded}}}`;
			}
			// A literal secret in a public template protects nothing; sign now.
			return signJwtHs256(secret.value, payload);
		}
		default:
			throw new BlueprintError(`unknown helper "${helper}"`);
	}
}

interface MappedVariable {
	value: string;
	/** True when the value carries a deploy-time placeholder. */
	generated: boolean;
}

/**
 * Resolve `[variables]`: literals, references between variables, helpers.
 * Order-independent for references (bounded passes), so a variable may use
 * one declared below it.
 */
function mapVariables(table: TomlTable | undefined): Map<string, MappedVariable> {
	const raw = new Map<string, string>();
	for (const [name, value] of Object.entries(table ?? {})) {
		const text = asString(value);
		if (text === undefined) throw new BlueprintError(`variable "${name}" is not a string`);
		raw.set(name, text);
	}
	const mapped = new Map<string, MappedVariable>();
	const resolve = (name: string, stack: string[]): MappedVariable => {
		const known = mapped.get(name);
		if (known) return known;
		if (stack.includes(name)) throw new BlueprintError(`variable "${name}" references itself`);
		const text = raw.get(name);
		if (text === undefined) throw new BlueprintError(`unknown variable "${name}"`);
		let occurrence = 0;
		let generated = false;
		const value = text.replace(HELPER_RE, (match, inner: string) => {
			const ref = !isHelper(inner) && raw.has(inner) ? inner : null;
			if (ref) {
				const resolved = resolve(ref, [...stack, name]);
				generated ||= resolved.generated;
				return resolved.value;
			}
			occurrence += 1;
			// Named after the variable so every key that uses it gets the same
			// value; a second helper in the same variable gets its own name.
			const helperName = occurrence === 1 ? name : `${name}_${occurrence}`;
			const out = mapHelper(inner, helperName, mapped);
			if (out.includes("{{")) generated = true;
			return out === match ? match : out;
		});
		const result = { value, generated };
		mapped.set(name, result);
		return result;
	};
	for (const name of raw.keys()) resolve(name, []);
	return mapped;
}

/** `[config.env]` table or `env = ["K=V"]` array → key/value pairs with variables substituted. */
function mapEnv(
	config: TomlTable | undefined,
	variables: ReadonlyMap<string, MappedVariable>,
): Template["env"] {
	const pairs: Array<[string, string]> = [];
	const envValue = config?.env;
	const scalar = (value: TomlValue | undefined): string | undefined =>
		typeof value === "boolean" ? String(value) : asString(value);
	if (Array.isArray(envValue)) {
		for (const entry of envValue) {
			const text = asString(entry)?.trim();
			// A dotenv-style list: comment lines and blanks are not entries.
			if (!text || text.startsWith("#")) continue;
			const equals = text.indexOf("=");
			if (equals === -1) throw new BlueprintError(`env entry "${text}" has no "="`);
			pairs.push([text.slice(0, equals).trim(), text.slice(equals + 1)]);
		}
	} else if (tableOf(envValue)) {
		for (const [key, value] of Object.entries(tableOf(envValue) ?? {})) {
			const text = scalar(value);
			if (text === undefined) throw new BlueprintError(`env "${key}" is not a string`);
			pairs.push([key, text]);
		}
	}
	const keys = new Set(pairs.map(([key]) => key));

	return pairs.map(([key, rawValue]) => {
		if (!ENV_KEY_RE.test(key)) throw new BlueprintError(`env key "${key}" is not shell-safe`);
		let generated = false;
		let usesDomain = false;
		const value = rawValue.replace(HELPER_RE, (match, inner: string) => {
			const variable = !isHelper(inner) ? variables.get(inner) : undefined;
			if (variable) {
				generated ||= variable.generated;
				usesDomain ||= variable.value.includes("{{domain}}");
				return variable.value;
			}
			if (isHelper(inner)) {
				// A helper used inline in an env value, without a variable.
				const out = mapHelper(inner, key.toLowerCase(), variables);
				if (out.includes("{{")) generated = true;
				usesDomain ||= out === "{{domain}}";
				return out === match ? match : out;
			}
			// `${OTHER_KEY}`: another key of the same file — the source leaves
			// it for the env file to expand; here the resolver does it.
			if (keys.has(inner) && inner !== key) return `{{env:${inner}}}`;
			return match;
		});
		const description = usesDomain
			? "Uses the domain you attach at deploy"
			: generated
				? "Generated at deploy"
				: "";
		return { key, default: value, description };
	});
}

interface MountSpec {
	filePath: string;
	content: string;
}

const configNameFor = (filePath: string): string =>
	`tpl-${filePath
		.replace(/^\/+/, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/-+$/, "")
		.toLowerCase()}`.slice(0, 63);

/**
 * Rewrite the compose file: file mounts become inline configs, `env_file`
 * becomes explicit environment entries. Returns the new YAML and notes.
 */
function rewriteCompose(
	compose: string,
	mounts: MountSpec[],
	envKeys: string[],
): { compose: string; notes: string[] } {
	let spec: unknown;
	try {
		spec = parseYaml(compose);
	} catch (error) {
		throw new BlueprintError(
			`docker-compose.yml does not parse: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
		throw new BlueprintError("docker-compose.yml is not a mapping");
	}
	const root = spec as Record<string, unknown>;
	const services = root.services;
	if (!services || typeof services !== "object" || Array.isArray(services)) {
		throw new BlueprintError("docker-compose.yml has no services");
	}
	const notes: string[] = [];
	const byPath = new Map(mounts.map((mount) => [mount.filePath.replace(/^\/+/, ""), mount]));
	const usedConfigs = new Map<string, MountSpec>();
	const namedVolumes = new Set<string>();

	for (const [serviceName, rawService] of Object.entries(services as Record<string, unknown>)) {
		if (!rawService || typeof rawService !== "object" || Array.isArray(rawService)) continue;
		const service = rawService as Record<string, unknown>;

		if (Array.isArray(service.volumes)) {
			const original: unknown[] = service.volumes;
			const kept: unknown[] = [];
			const attached: Array<{ source: string; target: string }> = [];
			for (const entry of service.volumes) {
				const text = typeof entry === "string" ? entry : null;
				// The clock idiom: harmless, but a host bind mount all the same,
				// which compose safety refuses. Containers get UTC instead.
				if (
					text &&
					/^\/etc\/(localtime|timezone):\/etc\/(localtime|timezone)(?::ro)?$/.test(text)
				) {
					notes.push(
						`service "${serviceName}": dropped the ${text.split(":")[0]} bind mount (host paths are not mounted here)`,
					);
					continue;
				}
				// `../files/x:/y`, and the `./files/` spelling some blueprints use.
				// Trailing mode flags are normalized: `ro` is kept, and the SELinux
				// relabel flags (`z`/`Z`) and the macOS consistency hints mean
				// nothing once the file is an inline config or a named volume.
				const match = text
					? /^\.{1,2}\/files\/([^:]+):([^:]+)(?::([a-zA-Z,]+))?$/.exec(text)
					: null;
				if (!match) {
					if (text?.startsWith("../files/") || text?.startsWith("./files/")) {
						throw new BlueprintError(`service "${serviceName}" mounts an unknown file: ${text}`);
					}
					kept.push(entry);
					continue;
				}
				const filePath = (match[1] ?? "").replace(/^\/+/, "");
				const mount = byPath.get(filePath);
				if (!mount) {
					// A directory under the stack's files folder, used as persistent
					// storage: the closest thing here is a named volume of the stack.
					const volume = `tpl-${filePath
						.replace(/[^a-zA-Z0-9]+/g, "-")
						.replace(/^-+|-+$/g, "")
						.toLowerCase()}`.slice(0, 63);
					namedVolumes.add(volume);
					const readOnly = (match[3] ?? "").split(",").includes("ro");
					kept.push(`${volume}:${match[2] ?? ""}${readOnly ? ":ro" : ""}`);
					notes.push(
						`service "${serviceName}": ../files/${filePath} is a directory, kept as the named volume ${volume}`,
					);
					continue;
				}
				const name = configNameFor(filePath);
				usedConfigs.set(name, mount);
				attached.push({ source: name, target: match[2] ?? "" });
			}
			if (
				attached.length > 0 ||
				kept.length !== original.length ||
				kept.some((entry, index) => entry !== original[index])
			) {
				service.volumes = kept.length > 0 ? kept : undefined;
				if (service.volumes === undefined) delete service.volumes;
				const existing = Array.isArray(service.configs) ? service.configs : [];
				service.configs = [...existing, ...attached];
			}
		}

		// Routing labels of the other panel. Here routing is a domain row and a
		// generated Traefik file (compose safety refuses the labels outright),
		// so they are dropped the same way `env_file` is rewritten below: the
		// stack still gets a domain, from the panel rather than from the file.
		if (service.labels !== undefined && service.labels !== null) {
			const kept = withoutTraefikLabels(service.labels);
			if (kept.dropped > 0) {
				notes.push(
					`service "${serviceName}": dropped ${kept.dropped} traefik.* label${
						kept.dropped === 1 ? "" : "s"
					} (attach a domain in the panel instead)`,
				);
				if (kept.labels === undefined) delete service.labels;
				else service.labels = kept.labels;
			}
		}

		if (service.env_file !== undefined) {
			delete service.env_file;
			const environment = service.environment;
			const present = new Set<string>();
			if (Array.isArray(environment)) {
				for (const entry of environment) {
					if (typeof entry === "string") present.add(entry.split("=")[0] ?? "");
				}
				service.environment = [
					...environment,
					...envKeys.filter((key) => !present.has(key)).map((key) => `${key}=\${${key}}`),
				];
			} else {
				const map =
					environment && typeof environment === "object"
						? { ...(environment as Record<string, unknown>) }
						: {};
				for (const key of envKeys) {
					if (!(key in map)) map[key] = `\${${key}}`;
				}
				service.environment = map;
			}
		}
	}

	for (const mount of mounts) {
		const name = configNameFor(mount.filePath.replace(/^\/+/, ""));
		if (!usedConfigs.has(name)) {
			notes.push(`file ${mount.filePath} is defined but no service mounts it; dropped`);
		}
	}
	if (namedVolumes.size > 0) {
		const volumes =
			root.volumes && typeof root.volumes === "object" && !Array.isArray(root.volumes)
				? { ...(root.volumes as Record<string, unknown>) }
				: {};
		for (const name of namedVolumes) {
			if (!(name in volumes)) volumes[name] = {};
		}
		root.volumes = volumes;
	}
	if (usedConfigs.size > 0) {
		const configs =
			root.configs && typeof root.configs === "object" && !Array.isArray(root.configs)
				? { ...(root.configs as Record<string, unknown>) }
				: {};
		for (const [name, mount] of usedConfigs) {
			configs[name] = { content: mount.content };
		}
		root.configs = configs;
	}

	return { compose: stringifyYaml(root, { lineWidth: 0 }), notes };
}

/**
 * A service's labels without the `traefik.*` ones, and how many went. Both
 * compose label shapes are handled (`["k=v"]` and `{k: v}`); `undefined`
 * means nothing is left to write back.
 */
function withoutTraefikLabels(labels: unknown): { labels: unknown; dropped: number } {
	const isTraefik = (key: string) => key.trim().toLowerCase().startsWith("traefik.");
	if (Array.isArray(labels)) {
		const kept = labels.filter(
			(entry) => !(typeof entry === "string" && isTraefik(entry.split("=")[0] ?? "")),
		);
		return { labels: kept.length > 0 ? kept : undefined, dropped: labels.length - kept.length };
	}
	if (labels && typeof labels === "object") {
		const entries = Object.entries(labels as Record<string, unknown>);
		const kept = entries.filter(([key]) => !isTraefik(key));
		return {
			labels: kept.length > 0 ? Object.fromEntries(kept) : undefined,
			dropped: entries.length - kept.length,
		};
	}
	return { labels, dropped: 0 };
}

/** Name of the first service defined by the file, for the domain fallback. */
function firstServiceName(compose: string): string | null {
	let spec: unknown;
	try {
		spec = parseYaml(compose);
	} catch {
		return null;
	}
	const services = (spec as { services?: Record<string, unknown> } | null)?.services;
	if (!services || typeof services !== "object") return null;
	return Object.keys(services)[0] ?? null;
}

/** First `expose:` (or `ports:` target) of the first service that has one. */
function firstExposedPort(compose: string): { serviceName: string; port: number } | null {
	let spec: unknown;
	try {
		spec = parseYaml(compose);
	} catch {
		return null;
	}
	const services = (spec as { services?: Record<string, unknown> } | null)?.services;
	if (!services || typeof services !== "object") return null;
	for (const [serviceName, raw] of Object.entries(services)) {
		if (!raw || typeof raw !== "object") continue;
		const service = raw as { expose?: unknown; ports?: unknown };
		for (const entry of Array.isArray(service.expose) ? service.expose : []) {
			const port = Number.parseInt(String(entry).split("/")[0] ?? "", 10);
			if (Number.isFinite(port) && port > 0) return { serviceName, port };
		}
		for (const entry of Array.isArray(service.ports) ? service.ports : []) {
			const text =
				typeof entry === "string" ? entry : typeof entry === "number" ? String(entry) : null;
			const target = text
				? Number.parseInt(text.split(":").pop()?.split("/")[0] ?? "", 10)
				: Number.NaN;
			if (Number.isFinite(target) && target > 0) return { serviceName, port: target };
		}
	}
	return null;
}

const httpsOrUndefined = (value: string | undefined): string | undefined =>
	value && /^https:\/\//i.test(value) ? value : undefined;

export function mapBlueprint(input: BlueprintInput): MappedBlueprint {
	const meta = metaSchema.safeParse(input.meta);
	if (!meta.success) {
		throw new BlueprintError(`meta.json: ${meta.error.issues[0]?.message ?? "invalid"}`);
	}
	let toml: TomlTable;
	try {
		toml = parseToml(input.toml);
	} catch (error) {
		throw new BlueprintError(
			`template.toml: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const variables = mapVariables(tableOf(toml.variables));
	const config = tableOf(toml.config);
	const env = mapEnv(config, variables);

	const domains = arrayOf(config?.domains)
		.map(tableOf)
		.filter((entry): entry is TomlTable => entry !== undefined);
	const first = domains[0];
	let serviceName = first ? asString(first.serviceName) : undefined;
	let port = first && typeof first.port === "number" ? first.port : undefined;
	const notes: string[] = [];
	if (!serviceName || !port) {
		// No domain declared: suggest the first service that exposes a port,
		// so the operator can still attach one from the gallery.
		const exposed = firstExposedPort(input.compose);
		if (exposed) {
			serviceName = exposed.serviceName;
			port = exposed.port;
			notes.push(`declares no domain; ${serviceName}:${port} is suggested from its expose: list`);
		} else {
			// Nothing declares a port: a tunnel client, a cache, an agent. Those
			// are worth having in the gallery, and the domain step of the deploy
			// wizard is optional — so suggest the first service on 80 (what an
			// exported stack does with the same question) rather than dropping
			// the template over a field nobody has to use.
			const first = firstServiceName(input.compose);
			if (!first) {
				throw new BlueprintError("docker-compose.yml has no services");
			}
			serviceName = first;
			port = 80;
			notes.push(`declares no domain and exposes no port; ${first}:80 is a placeholder suggestion`);
		}
	}

	const mounts: MountSpec[] = arrayOf(config?.mounts)
		.map(tableOf)
		.filter((entry): entry is TomlTable => entry !== undefined)
		.map((entry) => {
			const filePath = asString(entry.filePath);
			const content = asString(entry.content) ?? "";
			if (!filePath) throw new BlueprintError("a [[config.mounts]] entry has no filePath");
			return { filePath, content };
		});

	const rewritten = rewriteCompose(
		input.compose,
		mounts,
		env.map((entry) => entry.key),
	);
	notes.push(...rewritten.notes);
	if (domains.length > 1) {
		notes.push(
			`declares ${domains.length} domains; only ${serviceName}:${port} is suggested, attach the others by hand`,
		);
	}

	// The schema caps the list; a blueprint with 30 keywords is a long tag
	// list, not a broken template.
	const tags = (meta.data.tags ?? []).slice(0, 24);
	const logo = meta.data.logo?.trim() ?? "";
	return {
		template: {
			id: input.id,
			name: meta.data.name,
			description: meta.data.description ?? "",
			logo: /^https:\/\//i.test(logo)
				? logo
				: logo && !logo.includes("/") && !logo.includes("..")
					? input.assetUrl(logo)
					: "",
			// Tags, not a category: the first tag used to become one verbatim,
			// which gave the public catalog 209 categories for 436 templates.
			// `categoryFromTags` resolves them against the built-in vocabulary.
			category: categoryFromTags(tags),
			tags,
			links: {
				website: httpsOrUndefined(meta.data.links?.website),
				docs: httpsOrUndefined(meta.data.links?.docs),
				github: httpsOrUndefined(meta.data.links?.github),
			},
			compose: rewritten.compose,
			env,
			suggestedDomain: { serviceName, port },
		},
		notes,
	};
}

/** Exported for tests: a stable, secret-free random string helper is not needed elsewhere. */
export const _internal = { randomBytes };
