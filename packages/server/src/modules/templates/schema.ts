import { z } from "zod";
import type { Template } from "./types";

/**
 * Zod mirror of the `Template` interface, used to validate every entry a
 * remote source hands us. A source is untrusted input: the compose body ends
 * up in `assertSafeComposeSpec` at deploy time, but everything else (ids,
 * logos, links) is rendered in the panel, so it is bounded and shape-checked
 * here — before a single byte reaches the cache.
 */

/** Built-in ids are kebab-case; remote ids use the same alphabet so both can be namespaced. */
export const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Per-template compose body cap; the whole document is capped separately. */
export const MAX_TEMPLATE_COMPOSE_BYTES = 128 * 1024;

const linkSchema = z
	.string()
	.max(2048)
	.refine((value) => /^https:\/\//i.test(value), "links must be https URLs");

const envVarSchema = z.object({
	key: z
		.string()
		.min(1)
		.max(128)
		.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "env keys must be shell-safe (A-Z, 0-9, _)"),
	default: z.string().max(4096).default(""),
	description: z.string().max(512).default(""),
});

export const remoteTemplateSchema = z.object({
	id: z.string().regex(TEMPLATE_ID_PATTERN, "id must be kebab-case (a-z, 0-9, . _ -)"),
	name: z.string().min(1).max(120),
	description: z.string().max(1024).default(""),
	/** simple-icons slug or an absolute https image URL — never a data: URI. */
	logo: z
		.string()
		.max(2048)
		.default("")
		.refine(
			(value) => value === "" || /^https:\/\//i.test(value) || /^[a-z0-9.-]+$/i.test(value),
			"logo must be a simple-icons slug or an https URL",
		),
	category: z.string().min(1).max(64).default("Custom"),
	tags: z.array(z.string().min(1).max(48)).max(24).default([]),
	links: z
		.object({
			website: linkSchema.optional(),
			docs: linkSchema.optional(),
			github: linkSchema.optional(),
		})
		.default({}),
	compose: z.string().min(1).max(MAX_TEMPLATE_COMPOSE_BYTES),
	env: z.array(envVarSchema).max(200).default([]),
	/** Post-deploy steps, one line each, rendered as a numbered list. */
	setup: z.array(z.string().min(1).max(600)).max(20).default([]),
	/** Hostnames read from env values and attached on deploy (`TemplateDomainHint`). */
	domains: z
		.array(
			z.object({
				env: z.string().min(1).max(128),
				serviceName: z
					.string()
					.min(1)
					.max(64)
					.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "serviceName must be a compose service name"),
				port: z.number().int().min(1).max(65535),
				wildcard: z.boolean().optional(),
				https: z.boolean().optional(),
			}),
		)
		.max(8)
		.default([]),
	suggestedDomain: z.object({
		serviceName: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "serviceName must be a compose service name"),
		port: z.number().int().min(1).max(65535),
	}),
	// `hostPrivileged` is deliberately NOT accepted from a remote source: it
	// relaxes the compose safety checks and is an instance-admin decision
	// about the built-in catalog only.
});

/** How many templates one source may contribute. */
export const MAX_TEMPLATES_PER_SOURCE = 1000;

/**
 * A source document: either a bare array or `{ templates: [...] }`, so an
 * index can carry its own metadata without breaking the parser.
 */
export const templateIndexSchema = z.union([
	z.array(z.unknown()).max(MAX_TEMPLATES_PER_SOURCE),
	z
		.object({ templates: z.array(z.unknown()).max(MAX_TEMPLATES_PER_SOURCE) })
		.transform((value) => value.templates),
]);

export interface ParsedTemplateIndex {
	templates: Template[];
	/** One line per rejected entry; the sync keeps the rest. */
	rejected: string[];
}

/**
 * Validate a parsed index. Bad entries are dropped with a reason instead of
 * failing the whole sync: one broken template in a 200-entry catalog should
 * not take the other 199 offline.
 */
export function parseTemplateIndex(document: unknown): ParsedTemplateIndex {
	const outer = templateIndexSchema.safeParse(document);
	if (!outer.success) {
		throw new Error(
			"Template index must be a JSON array of templates, or an object with a `templates` array",
		);
	}
	const templates: Template[] = [];
	const rejected: string[] = [];
	const seen = new Set<string>();
	outer.data.forEach((entry, index) => {
		const parsed = remoteTemplateSchema.safeParse(entry);
		if (!parsed.success) {
			const label =
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as { id?: unknown }).id === "string"
					? String((entry as { id: string }).id)
					: `#${index}`;
			const issue = parsed.error.issues[0];
			rejected.push(
				`${label}: ${issue ? `${issue.path.join(".") || "(root)"} ${issue.message}` : "invalid"}`,
			);
			return;
		}
		if (seen.has(parsed.data.id)) {
			rejected.push(`${parsed.data.id}: duplicate id in the index`);
			return;
		}
		seen.add(parsed.data.id);
		templates.push(parsed.data);
	});
	return { templates, rejected };
}
