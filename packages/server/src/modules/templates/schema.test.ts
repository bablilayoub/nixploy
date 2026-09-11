import { describe, expect, it } from "vitest";
import { MAX_TEMPLATE_COMPOSE_BYTES, parseTemplateIndex } from "./schema";

const valid = {
	id: "uptime-kuma",
	name: "Uptime Kuma",
	description: "Self-hosted monitoring",
	logo: "uptimekuma",
	category: "Monitoring",
	tags: ["monitoring"],
	links: { website: "https://uptime.kuma.pet" },
	compose: "services:\n  app:\n    image: louislam/uptime-kuma:1\n",
	env: [{ key: "PORT", default: "3001", description: "HTTP port" }],
	suggestedDomain: { serviceName: "app", port: 3001 },
};

describe("parseTemplateIndex", () => {
	it("accepts a bare array", () => {
		const { templates, rejected } = parseTemplateIndex([valid]);
		expect(rejected).toEqual([]);
		expect(templates).toHaveLength(1);
		expect(templates[0]?.id).toBe("uptime-kuma");
	});

	it("accepts `{ templates: [...] }` so an index can carry its own metadata", () => {
		const { templates } = parseTemplateIndex({ generatedAt: "now", templates: [valid] });
		expect(templates).toHaveLength(1);
	});

	it("fills in the optional fields", () => {
		const minimal = {
			id: "minimal",
			name: "Minimal",
			compose: "services:\n  app:\n    image: nginx:1\n",
			suggestedDomain: { serviceName: "app", port: 80 },
		};
		const { templates, rejected } = parseTemplateIndex([minimal]);
		expect(rejected).toEqual([]);
		expect(templates[0]).toMatchObject({
			description: "",
			category: "Custom",
			tags: [],
			env: [],
			links: {},
		});
	});

	it("rejects the whole document only when it is not an index at all", () => {
		expect(() => parseTemplateIndex("nope")).toThrow(/JSON array of templates/);
		expect(() => parseTemplateIndex({ items: [] })).toThrow(/JSON array of templates/);
		expect(() => parseTemplateIndex(null)).toThrow(/JSON array of templates/);
	});

	it("drops a bad entry with a reason and keeps the rest", () => {
		const { templates, rejected } = parseTemplateIndex([
			valid,
			{ ...valid, id: "Bad Id With Spaces" },
			{ ...valid, id: "no-compose", compose: "" },
			{ name: "no id at all" },
		]);
		expect(templates.map((entry) => entry.id)).toEqual(["uptime-kuma"]);
		expect(rejected).toHaveLength(3);
		expect(rejected[0]).toMatch(/^Bad Id With Spaces: id/);
		expect(rejected[1]).toMatch(/^no-compose: compose/);
		// An entry with no usable id is labelled by position, never by index alone.
		expect(rejected[2]).toMatch(/^#3: /);
	});

	it("drops duplicate ids instead of letting the last one win silently", () => {
		const { templates, rejected } = parseTemplateIndex([valid, { ...valid, name: "Impostor" }]);
		expect(templates).toHaveLength(1);
		expect(templates[0]?.name).toBe("Uptime Kuma");
		expect(rejected[0]).toMatch(/duplicate id/);
	});

	it("refuses non-https links and data: logos", () => {
		const { rejected: linkRejected } = parseTemplateIndex([
			{ ...valid, links: { website: "javascript:alert(1)" } },
		]);
		expect(linkRejected[0]).toMatch(/links must be https URLs/);

		const { rejected: logoRejected } = parseTemplateIndex([
			{ ...valid, logo: "data:image/svg+xml;base64,AAAA" },
		]);
		expect(logoRejected[0]).toMatch(/simple-icons slug or an https URL/);
	});

	it("refuses env keys that are not shell-safe", () => {
		const { rejected } = parseTemplateIndex([
			{ ...valid, env: [{ key: "PATH; rm -rf /", default: "", description: "" }] },
		]);
		expect(rejected[0]).toMatch(/shell-safe/);
	});

	it("never lets a remote source claim hostPrivileged", () => {
		const { templates } = parseTemplateIndex([{ ...valid, hostPrivileged: true }]);
		expect(templates[0]).not.toHaveProperty("hostPrivileged");
	});

	it("caps the compose body", () => {
		const { rejected } = parseTemplateIndex([
			{ ...valid, compose: "x".repeat(MAX_TEMPLATE_COMPOSE_BYTES + 1) },
		]);
		expect(rejected).toHaveLength(1);
	});

	it("caps how many templates one source may contribute", () => {
		const many = Array.from({ length: 501 }, (_, index) => ({ ...valid, id: `t-${index}` }));
		expect(() => parseTemplateIndex(many)).toThrow(/JSON array of templates/);
	});
});
