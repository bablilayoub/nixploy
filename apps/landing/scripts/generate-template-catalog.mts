/**
 * Regenerates `src/lib/templates.ts` — the data behind nixploy.com/templates
 * and the per-template pages — from the real catalog in
 * `packages/server/src/modules/templates`.
 *
 * Generated rather than imported, for the same reason `api-catalog.ts` is:
 * `apps/landing` deliberately has no dependency on `@nixploy/server`, and
 * adding one would pull drizzle, dockerode and ssh2 into a marketing build.
 * Hand-maintaining a second copy of the entries would drift within a release.
 *
 * Compose bodies are NOT emitted. They are the largest part of the catalog by
 * far and nothing on a template page renders one; what a reader actually wants
 * — which images this runs, which variables it asks for, which port it serves
 * — is derived from the body here, once, and shipped as a few short strings.
 *
 * Re-run after adding, renaming or removing a template (from anywhere in the
 * repo — `pnpm -F` runs with `packages/server` as the working directory, which
 * is what the `../../` is relative to):
 *
 *   pnpm -F @nixploy/server exec tsx ../../apps/landing/scripts/generate-template-catalog.mts
 *   pnpm exec biome check --write apps/landing/src/lib/templates.ts
 *
 * The extension is `.mts` on purpose: `tsconfig.json` includes `**\/*.ts`, so a
 * `.ts` script here would drag the whole server package into the landing
 * type-check.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The server module graph asserts a real key at import time (see auth.md). */
process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { templates } = await import("../../../packages/server/src/modules/templates/catalog.ts");

/**
 * Container images a compose body pulls, in file order and deduplicated.
 *
 * A deliberately small regex rather than a YAML parse: the bodies are the
 * repo's own, every one of them writes `image:` at the start of a line, and a
 * parser here would be a second implementation of something the panel already
 * does properly at deploy time.
 */
function imagesOf(compose: string): string[] {
	const found: string[] = [];
	for (const line of compose.split("\n")) {
		const match = /^\s{2,}image:\s*["']?([^"'\s#]+)/.exec(line);
		const image = match?.[1];
		if (image && !image.includes("${") && !found.includes(image)) found.push(image);
	}
	return found;
}

/** Named volumes the stack declares, so a page can say what survives a redeploy. */
function volumesOf(compose: string): string[] {
	const block = /\nvolumes:\n([\s\S]*?)(\n\S|\s*$)/.exec(compose);
	if (!block?.[1]) return [];
	return block[1]
		.split("\n")
		.map((line) => /^\s{2}([A-Za-z0-9_.-]+):/.exec(line)?.[1])
		.filter((name): name is string => Boolean(name));
}

const quote = (value: string) => JSON.stringify(value);

const rows = templates
	.map((template) => {
		const images = imagesOf(template.compose);
		const volumes = volumesOf(template.compose);
		const env = template.env.map((variable) => ({
			key: variable.key,
			description: variable.description,
			// Nixploy fills these in at deploy time; a page should say so rather
			// than implying the reader has to invent a password.
			generated: variable.default === "{{generateSecret}}",
		}));
		return [
			"\t{",
			`\t\tid: ${quote(template.id)},`,
			`\t\tname: ${quote(template.name)},`,
			`\t\tdescription: ${quote(template.description)},`,
			`\t\tlogo: ${quote(template.logo)},`,
			`\t\tcategory: ${quote(template.category)},`,
			`\t\ttags: [${template.tags.map(quote).join(", ")}],`,
			`\t\tlinks: {${[
				template.links.website ? ` website: ${quote(template.links.website)},` : "",
				template.links.docs ? ` docs: ${quote(template.links.docs)},` : "",
				template.links.github ? ` github: ${quote(template.links.github)},` : "",
			]
				.filter(Boolean)
				.join("")} },`,
			`\t\timages: [${images.map(quote).join(", ")}],`,
			`\t\tvolumes: [${volumes.map(quote).join(", ")}],`,
			`\t\tenv: [${env
				.map(
					(variable) =>
						`{ key: ${quote(variable.key)}, description: ${quote(variable.description)}${
							variable.generated ? ", generated: true" : ""
						} }`,
				)
				.join(", ")}],`,
			`\t\tport: ${template.suggestedDomain.port},`,
			`\t\tserviceName: ${quote(template.suggestedDomain.serviceName)},`,
			...(template.setup && template.setup.length > 0
				? [`\t\tsetup: [${template.setup.map(quote).join(", ")}],`]
				: []),
			...(template.domains && template.domains.length > 0
				? [
						`\t\tdomains: [${template.domains
							.map(
								(hint) =>
									`{ env: ${quote(hint.env)}, serviceName: ${quote(hint.serviceName)}, port: ${hint.port}${
										hint.wildcard ? ", wildcard: true" : ""
									}${hint.https === false ? ", https: false" : ""} }`,
							)
							.join(", ")}],`,
					]
				: []),
			...(template.hostPrivileged ? ["\t\thostPrivileged: true,"] : []),
			"\t},",
		].join("\n");
	})
	.join("\n");

const categories = [...new Set(templates.map((template) => template.category))];

const body = `// Generated by apps/landing/scripts/generate-template-catalog.mts — do not edit by hand.
// Re-run: pnpm -F @nixploy/server exec tsx ../../apps/landing/scripts/generate-template-catalog.mts
//
// Source of truth: packages/server/src/modules/templates/data/*.ts. Compose
// bodies are not mirrored here; \`images\`, \`volumes\` and \`env\` are derived
// from them at generation time, which is everything a template page renders.

export interface TemplateEntry {
	id: string;
	name: string;
	description: string;
	/** simple-icons slug or an absolute image URL. */
	logo: string;
	category: string;
	tags: string[];
	links: { website?: string; docs?: string; github?: string };
	/** Container images the stack pulls. */
	images: string[];
	/** Named volumes it declares — what survives a redeploy. */
	volumes: string[];
	/** Variables the deploy form asks for; \`generated\` ones Nixploy fills in. */
	env: { key: string; description: string; generated?: boolean }[];
	/** Container port the suggested domain routes to. */
	port: number;
	serviceName: string;
	/** Post-deploy steps, one line each, in order. */
	setup?: string[];
	/** Hostnames attached on deploy from the named env values (\`*.\` for a wildcard). */
	domains?: { env: string; serviceName: string; port: number; wildcard?: boolean; https?: boolean }[];
	/** Needs the Docker socket or elevated capabilities; instance admin only. */
	hostPrivileged?: boolean;
}

export const templateCatalog: TemplateEntry[] = [
${rows}
];

export const templateCategories = [${categories.map(quote).join(", ")}] as const;

export const templateSlugs = templateCatalog.map((template) => template.id);

export const findTemplate = (id: string): TemplateEntry | undefined =>
	templateCatalog.find((template) => template.id === id);

export const templateCount = ${templates.length};
`;

const out = fileURLToPath(new URL("../src/lib/templates.ts", import.meta.url));
writeFileSync(out, body);
console.log(
	`Wrote ${out}: ${templates.length} templates, ${categories.length} categories.\n` +
		"Run `pnpm exec biome check --write apps/landing/src/lib/templates.ts`.",
);
