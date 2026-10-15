import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { DomainError } from "../errors";
import { categoryFromTags } from "./categories";
import {
	MAX_TEMPLATE_COMPOSE_BYTES,
	MAX_TEMPLATES_PER_SOURCE,
	type ParsedTemplateIndex,
	remoteTemplateSchema,
	TEMPLATE_ID_PATTERN,
} from "./schema";
import type { Template, TemplateEnvVar } from "./types";

/**
 * Pure translation of Coolify's templates/service-templates.json. Reference:
 * https://coolify.io/docs/services/configuration/docker-compose
 * https://coolify.io/docs/contribute/service
 *
 * No random values are created while syncing. Complete magic variable names
 * become named deploy-time generators, so references agree within a new
 * installation and the stored env stays stable on ordinary redeploys.
 *
 * The gallery currently configures one public service target. Multiple targets,
 * Coolify file-content mounts and health exclusions are rejected explicitly,
 * rather than indexing a stack with silently changed semantics. The shared
 * source pipeline still applies every Compose safety check after translation.
 */
class CoolifyTemplateError extends DomainError {
	constructor(message: string) {
		super("BAD_REQUEST", message);
	}
}

const entrySchema = z.object({
	compose: z
		.string()
		.min(1)
		.max(Math.ceil(MAX_TEMPLATE_COMPOSE_BYTES / 3) * 4 + 4),
	slogan: z.string().max(1024).default(""),
	documentation: z.string().max(2048).default(""),
	category: z
		.string()
		.max(64)
		.nullish()
		.transform((value) => value ?? ""),
	tags: z
		.array(z.string().min(1).max(48))
		.nullish()
		.transform((value) => value ?? []),
	logo: z.string().max(2048).default(""),
	port: z.union([z.string(), z.number()]).optional(),
});

const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const portNumber = (value: unknown): number | null => {
	const port = Number(value);
	return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};

const serviceAlias = (name: string): string => name.replace(/[-.]/g, "_").toUpperCase();
// The official catalog still carries legacy names such as UPTIMEKUMA for
// uptime-kuma. Accept that spelling only when it identifies one service.
const legacyServiceAlias = (name: string): string => name.replace(/[-._]/g, "").toUpperCase();

interface DomainTarget {
	serviceName: string;
	port: number;
}

function decodeCompose(encoded: string): string {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
		throw new CoolifyTemplateError("compose is not canonical Base64");
	}
	const bytes = Buffer.from(encoded, "base64");
	if (bytes.length > MAX_TEMPLATE_COMPOSE_BYTES) {
		throw new CoolifyTemplateError("decoded compose exceeds the per-template size limit");
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new CoolifyTemplateError("decoded compose is not UTF-8");
	}
}

function generatedDefault(key: string): string | null {
	const match =
		/^SERVICE_(LOWERCASEUSER|USER|PASSWORDWITHSYMBOLS|PASSWORD|REALBASE64|BASE64|HEX)_(?:(\d+)_)?([A-Z0-9]+)$/.exec(
			key,
		);
	if (!match) return null;
	const [, kind, size, id] = match;
	if (!id) return null;
	if (/^\d+$/.test(id)) {
		throw new CoolifyTemplateError(
			`ambiguous generator name ${key}: provide an identifier after the size`,
		);
	}
	const length = size ? Number(size) : kind?.includes("USER") ? 16 : 32;
	const allowed = kind?.includes("USER")
		? size === undefined
		: kind === "PASSWORD" || kind === "PASSWORDWITHSYMBOLS"
			? length === 32 || length === 64
			: kind === "HEX"
				? size !== undefined && [32, 64, 128].includes(length)
				: [32, 64, 128].includes(length);
	if (!allowed) throw new CoolifyTemplateError(`unsupported generator size in ${key}`);
	const generator =
		kind === "REALBASE64"
			? "generateBase64"
			: kind === "HEX"
				? "generateHash"
				: kind === "LOWERCASEUSER"
					? "generateLowercase"
					: kind === "PASSWORDWITHSYMBOLS"
						? "generateSymbols"
						: "generatePassword";
	return `{{${generator}:${length}:${key}}}`;
}

function translateEntry(id: string, input: unknown): Template {
	const result = entrySchema.safeParse(input);
	if (!result.success) {
		const issue = result.error.issues[0];
		throw new CoolifyTemplateError(`${issue?.path.join(".") || "entry"} ${issue?.message}`);
	}
	const entry = result.data;
	const raw = decodeCompose(entry.compose);
	const spec = record(parseYaml(raw));
	const services = record(spec?.services);
	if (!spec || !services || Object.keys(services).length === 0) {
		throw new CoolifyTemplateError("compose has no services mapping");
	}
	const names = Object.keys(services);
	const env = new Map<string, TemplateEnvVar>();
	const declaredDefaults = new Map<string, string>();
	const domainDeclarations: string[] = [];
	let target: DomainTarget | null = null;
	const topVolumes = spec.volumes === undefined ? {} : record(spec.volumes);
	if (!topVolumes) throw new CoolifyTemplateError("volumes must be a mapping");

	const serviceFor = (suffix: string): string => {
		const matches = names.filter(
			(name) => serviceAlias(name) === suffix || legacyServiceAlias(name) === suffix,
		);
		if (matches.length !== 1 || !matches[0]) {
			throw new CoolifyTemplateError(`magic service name ${suffix} does not identify one service`);
		}
		return matches[0];
	};
	const domainFor = (suffix: string): DomainTarget => {
		// An exact service match wins over treating its final number as a port.
		const exact = names.filter(
			(name) => serviceAlias(name) === suffix || legacyServiceAlias(name) === suffix,
		);
		const withPort = /^(.*)_(\d+)$/.exec(suffix);
		if (!exact.length && withPort && !portNumber(withPort[2])) {
			throw new CoolifyTemplateError(`invalid internal port in ${suffix}`);
		}
		const serviceName = serviceFor(exact.length ? suffix : (withPort?.[1] ?? suffix));
		const service = record(services[serviceName]);
		const exposed = Array.isArray(service?.expose) ? service.expose[0] : undefined;
		const port =
			(!exact.length && withPort ? portNumber(withPort[2]) : null) ??
			(target?.serviceName === serviceName ? target.port : null) ??
			portNumber(entry.port) ??
			portNumber(exposed);
		if (!port) throw new CoolifyTemplateError(`no internal port is declared for ${serviceName}`);
		const next = { serviceName, port };
		if (target && (target.serviceName !== serviceName || target.port !== port)) {
			throw new CoolifyTemplateError(
				"multiple public service targets require manual Compose setup",
			);
		}
		target = next;
		return next;
	};

	const addEnv = (key: string, fallback?: string, required = false): void => {
		if (!key.startsWith("SERVICE_") && fallback !== undefined) {
			const declared = declaredDefaults.get(key);
			if (declared !== undefined && declared !== fallback) {
				throw new CoolifyTemplateError(`conflicting defaults for ${key}`);
			}
			declaredDefaults.set(key, fallback);
		}
		let value = fallback ?? "";
		let description = required ? "Required before deployment." : "Optional Compose variable.";
		if (key.startsWith("SERVICE_")) {
			const domain = /^SERVICE_(URL|FQDN)_(.+)$/.exec(key);
			if (domain) {
				domainFor(domain[2] ?? "");
				value = domain[1] === "URL" ? "http://{{domain}}" : "{{domain}}";
				description =
					"Uses the domain attached in the next step. URL uses HTTP initially; update it after enabling HTTPS.";
			} else if (key.startsWith("SERVICE_NAME_")) {
				value = serviceFor(key.slice("SERVICE_NAME_".length));
				description = "Compose service name.";
			} else {
				const generated = generatedDefault(key);
				if (!generated) {
					throw new CoolifyTemplateError(`unsupported magic variable ${key}`);
				}
				value = generated;
				description = "Generated once for each new installation; retained on redeploy.";
			}
		} else if (value.includes("${") || /\$[A-Za-z_]/.test(value)) {
			throw new CoolifyTemplateError(`nested default for ${key} requires manual Compose setup`);
		}
		const previous = env.get(key);
		env.set(key, {
			key,
			default: previous?.default || value,
			description,
			...(required || previous?.required ? { required: true } : {}),
		});
	};

	// Discover domain declarations first, so a reference without a port reuses
	// the explicit port declared elsewhere rather than the metadata fallback.
	for (const [name, rawService] of Object.entries(services)) {
		const service = record(rawService);
		if (!service) throw new CoolifyTemplateError(`service ${name} must be a mapping`);
		if (service.exclude_from_hc !== undefined) {
			throw new CoolifyTemplateError(
				`service ${name}: exclude_from_hc requires manual health setup`,
			);
		}
		const entries = Array.isArray(service.environment)
			? service.environment
			: Object.entries(record(service.environment) ?? {}).map(([key, value]) =>
					value == null ? key : `${key}=${value}`,
				);
		for (const declaration of entries) {
			if (typeof declaration !== "string") {
				throw new CoolifyTemplateError(`service ${name}: environment entries must be strings`);
			}
			const [key, ...values] = declaration.split("=");
			if (/^SERVICE_(URL|FQDN)_/.test(key ?? "")) {
				const value = values.join("=");
				if (value && value !== `\${${key}}`) {
					throw new CoolifyTemplateError(
						`domain paths or overrides in ${key} require manual setup`,
					);
				}
				domainDeclarations.push(key ?? "");
			}
		}
		// Coolify adds omitted declarations for ordinary named volumes. Bind
		// paths, inline file content and custom drivers still reach safety or
		// are rejected here; no host mount is rewritten into an allowed one.
		for (const mount of Array.isArray(service.volumes) ? service.volumes : []) {
			const volume = record(mount);
			if (volume && ["content", "isDirectory", "is_directory"].some((key) => key in volume)) {
				throw new CoolifyTemplateError(
					`service ${name}: Coolify file-content mounts require manual setup`,
				);
			}
			const source = typeof mount === "string" ? mount.split(":")[0] : volume?.source;
			if (
				typeof source === "string" &&
				/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(source) &&
				(typeof mount === "string" ? mount.includes(":") : volume?.type === "volume")
			) {
				if (!Object.hasOwn(topVolumes, source)) topVolumes[source] = {};
			}
		}
	}
	// A port-less alias pairs with its explicit-port declaration regardless of
	// environment key order, as in SERVICE_URL_APP + SERVICE_URL_APP_3000.
	for (const key of domainDeclarations.sort(
		(a, b) => Number(/_\d+$/.test(b)) - Number(/_\d+$/.test(a)),
	)) {
		addEnv(key);
	}
	if (Object.keys(topVolumes).length) spec.volumes = topVolumes;

	const rewriteString = (text: string): string => {
		if (/\$\{[^{}]*\$\{/.test(text)) {
			throw new CoolifyTemplateError("nested Compose interpolation requires manual setup");
		}
		return text.replace(
			/\$\$|\$\{([^{}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
			(match, braced?: string, bare?: string) => {
				if (match === "$$") return match;
				if (bare) {
					addEnv(bare);
					return `\${${bare}}`;
				}
				const variable = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:-|:\?|-)(.*))?$/.exec(braced ?? "");
				if (!variable?.[1]) {
					throw new CoolifyTemplateError("unsupported Compose interpolation requires manual setup");
				}
				const [, key, operator, fallback] = variable;
				addEnv(key ?? "", operator ? fallback : undefined, operator === ":?");
				// Keep Compose's unset-versus-empty behavior after extracting form defaults.
				return match;
			},
		);
	};
	const ancestors = new Set<object>();
	const walk = (value: unknown, depth = 0): unknown => {
		if (typeof value === "string") return rewriteString(value);
		if (!value || typeof value !== "object") return value;
		if (depth > 40 || ancestors.has(value)) {
			throw new CoolifyTemplateError("cyclic or deeply nested YAML is unsupported");
		}
		ancestors.add(value);
		const out = Array.isArray(value)
			? value.map((item) => walk(item, depth + 1))
			: Object.fromEntries(
					Object.entries(value).map(([key, item]) => [key, walk(item, depth + 1)]),
				);
		ancestors.delete(value);
		return out;
	};
	const rewritten = record(walk(spec));
	// A bare environment key inherits the translated env, never the panel's
	// process environment. Make that relationship visible in the saved file.
	for (const rawService of Object.values(record(rewritten?.services) ?? {})) {
		const service = record(rawService);
		if (!service) continue;
		if (Array.isArray(service.environment)) {
			service.environment = service.environment.map((item) => {
				if (typeof item !== "string" || item.includes("=")) return item;
				addEnv(item);
				return `${item}=\${${item}}`;
			});
		} else {
			for (const [key, value] of Object.entries(record(service.environment) ?? {})) {
				if (value == null) {
					addEnv(key);
					(record(service.environment) ?? {})[key] = `\${${key}}`;
				}
			}
		}
	}
	const domainTarget = target as DomainTarget | null;
	const fallbackService = names[0] ?? "app";
	const tags = entry.tags.slice(0, 24);
	return remoteTemplateSchema.parse({
		id,
		name: id
			.split(/[-_]/)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" "),
		description: entry.slogan,
		logo: /^https:\/\//i.test(entry.logo)
			? entry.logo
			: /^svgs\/[a-zA-Z0-9_.-]+$/.test(entry.logo)
				? `https://raw.githubusercontent.com/coollabsio/coolify/main/${entry.logo}`
				: "",
		category: categoryFromTags([entry.category, ...tags]),
		tags,
		links: /^https:\/\//i.test(entry.documentation) ? { docs: entry.documentation } : {},
		compose: stringifyYaml(rewritten),
		env: [...env.values()],
		suggestedDomain: domainTarget ?? {
			serviceName: fallbackService,
			port: portNumber(entry.port) ?? 80,
		},
		requiresDomain: Boolean(domainTarget),
		setup: [
			"Review environment values and upstream documentation before deployment. Persistent data is created on the target server; no existing data is imported.",
			...(domainTarget
				? [
						"The initial domain uses HTTP. After enabling HTTPS in Domains, update SERVICE_URL values to use https://.",
					]
				: []),
		],
	});
}

/** One invalid entry does not discard the rest of the source. */
export function parseCoolifyCatalog(document: unknown): ParsedTemplateIndex {
	const index = record(document);
	if (!index)
		throw new CoolifyTemplateError("Coolify catalog must be an object keyed by template id");
	const entries = Object.entries(index);
	if (entries.length > MAX_TEMPLATES_PER_SOURCE) {
		throw new CoolifyTemplateError(`Coolify catalog exceeds ${MAX_TEMPLATES_PER_SOURCE} entries`);
	}
	const templates: Template[] = [];
	const rejected: string[] = [];
	for (const [id, entry] of entries) {
		if (!TEMPLATE_ID_PATTERN.test(id)) {
			rejected.push(`${id.slice(0, 64)}: invalid template id`);
			continue;
		}
		try {
			templates.push(translateEntry(id, entry));
		} catch (error) {
			rejected.push(`${id}: ${error instanceof Error ? error.message : "invalid entry"}`);
		}
	}
	return { templates, rejected };
}
