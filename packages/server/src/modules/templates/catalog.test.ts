import { describe, expect, it } from "vitest";
import {
	assertSafeComposeSpec,
	hostPrivilegedComposeSafety,
	listComposeServices,
	parseComposeFile,
} from "../compose/compose-file";
import { findTemplateById, listTemplateSummaries, templates } from "./catalog";

const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function composeEnvRefs(compose: string): string[] {
	const refs: string[] = [];
	for (const match of compose.matchAll(ENV_REF_PATTERN)) {
		if (match[1]) refs.push(match[1]);
	}
	return refs;
}

describe("template catalog", () => {
	it("has unique kebab-case ids", () => {
		const ids = templates.map((template) => template.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});

	it("findTemplateById resolves every template", () => {
		for (const template of templates) {
			expect(findTemplateById(template.id)?.id).toBe(template.id);
		}
		expect(findTemplateById("does-not-exist")).toBeUndefined();
	});

	it("every template has a non-empty category", () => {
		for (const template of templates) {
			expect(template.category.trim(), `${template.id} is missing a category`).not.toBe("");
		}
	});

	it("listTemplateSummaries strips compose bodies", () => {
		const summaries = listTemplateSummaries();
		expect(summaries).toHaveLength(templates.length);
		for (const summary of summaries) {
			expect(summary).not.toHaveProperty("compose");
		}
	});

	it.each(templates.map((template) => [template.id, template] as const))(
		"%s: compose body is valid YAML with services",
		(_id, template) => {
			const spec = parseComposeFile(template.compose);
			expect(Object.keys(spec.services ?? {}).length).toBeGreaterThan(0);
		},
	);

	it.each(templates.map((template) => [template.id, template] as const))(
		"%s: suggestedDomain targets an existing service",
		(_id, template) => {
			expect(listComposeServices(template.compose)).toContain(template.suggestedDomain.serviceName);
			expect(template.suggestedDomain.port).toBeGreaterThan(0);
			expect(template.suggestedDomain.port).toBeLessThanOrEqual(65535);
		},
	);

	it.each(templates.map((template) => [template.id, template] as const))(
		"%s: every compose $-variable is declared in the env schema and vice versa",
		(_id, template) => {
			const refs = new Set(composeEnvRefs(template.compose));
			const keys = new Set(template.env.map((envVar) => envVar.key));
			for (const ref of refs) {
				expect(keys, `missing env schema entry for \${${ref}}`).toContain(ref);
			}
			for (const key of keys) {
				expect(refs, `env schema key ${key} is unused in compose`).toContain(key);
			}
		},
	);

	it.each(templates.map((template) => [template.id, template] as const))(
		"%s: passes compose safety checks",
		(_id, template) => {
			expect(() =>
				assertSafeComposeSpec(
					parseComposeFile(template.compose),
					template.hostPrivileged ? hostPrivilegedComposeSafety() : undefined,
				),
			).not.toThrow();
		},
	);

	it.each(templates.map((template) => [template.id, template] as const))(
		"%s: exposes no host ports",
		(_id, template) => {
			const spec = parseComposeFile(template.compose);
			for (const [serviceName, service] of Object.entries(spec.services ?? {})) {
				expect(
					(service as Record<string, unknown>).ports,
					`service ${serviceName} must not publish host ports`,
				).toBeUndefined();
			}
		},
	);

	it("avoids known-unpublished image tags", () => {
		/** Floating / removed tags that previously broke deploys. */
		const bannedExact = new Set([
			"supabase/postgres-meta:latest",
			"supabase/gotrue:latest",
			"supabase/postgres:15.8.1",
			"supabase/studio:latest",
			"strapi/strapi:latest",
		]);
		const imagePattern = /^\s*image:\s*(\S+)\s*$/gm;
		for (const template of templates) {
			for (const match of template.compose.matchAll(imagePattern)) {
				const image = match[1] ?? "";
				expect(bannedExact.has(image), `${template.id} still references ${image}`).toBe(false);
				expect(image.startsWith("strapi/strapi:"), `${template.id} still references ${image}`).toBe(
					false,
				);
			}
		}
	});
});
