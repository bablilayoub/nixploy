import { describe, expect, it } from "vitest";

import { type CatalogTemplate, selectTemplates, sourceKeyOf } from "./template-catalog";
import type { TemplateFilters } from "./use-template-filters";
import { TEMPLATE_NEEDS } from "./use-template-filters";

const template = (
	id: string,
	overrides: Partial<CatalogTemplate> = {},
): CatalogTemplate & { id: string } => ({
	id,
	name: id,
	description: "",
	category: "Apps",
	tags: [],
	env: [],
	...overrides,
});

const rows = [
	template("grafana", { category: "Monitoring", tags: ["metrics", "charts"], env: [1, 2] }),
	template("uptime", { category: "Monitoring", tags: ["metrics"], env: [1] }),
	template("postgres", { category: "Databases", tags: ["sql"], env: [1, 2, 3] }),
	template("whoami", { category: "Apps", tags: [] }),
	template("portainer", { category: "Apps", tags: ["docker"], hostPrivileged: true, env: [1] }),
	template("minio", {
		category: "Storage",
		tags: ["s3"],
		env: [1, 2],
		source: { templateSourceId: "src-1", name: "Team catalog" },
	}),
];

const base: TemplateFilters = {
	query: "",
	categories: [],
	tags: [],
	sources: [],
	needs: [],
	sort: "category",
	view: "grid",
	page: 0,
};

const ids = (list: Array<{ id: string }>) => list.map((row) => row.id);
const select = (patch: Partial<TemplateFilters> = {}, pageSize = 100) =>
	selectTemplates(rows, { ...base, ...patch }, pageSize);

describe("selectTemplates", () => {
	it("sorts by category then name by default", () => {
		expect(ids(select().rows)).toEqual([
			"portainer",
			"whoami",
			"postgres",
			"grafana",
			"uptime",
			"minio",
		]);
	});

	it("sorts by name and by how much setup a template asks for", () => {
		expect(ids(select({ sort: "az" }).rows)[0]).toBe("grafana");
		expect(ids(select({ sort: "za" }).rows)[0]).toBe("whoami");
		expect(ids(select({ sort: "simplest" }).rows)[0]).toBe("whoami");
		expect(ids(select({ sort: "richest" }).rows)[0]).toBe("postgres");
	});

	it("matches the query against name, category, id and tags", () => {
		expect(ids(select({ query: "graf" }).rows)).toEqual(["grafana"]);
		expect(ids(select({ query: "databases" }).rows)).toEqual(["postgres"]);
		expect(ids(select({ query: "metrics" }).rows)).toEqual(["grafana", "uptime"]);
		expect(select({ query: "nothing here" }).rows).toEqual([]);
	});

	it("ORs within a facet and ANDs across facets", () => {
		expect(ids(select({ categories: ["Monitoring", "Databases"] }).rows)).toEqual([
			"postgres",
			"grafana",
			"uptime",
		]);
		// Category AND tag: only the monitoring template carrying `charts`.
		expect(ids(select({ categories: ["Monitoring"], tags: ["charts"] }).rows)).toEqual(["grafana"]);
	});

	it("filters by catalog, with the built-ins under one key", () => {
		expect(sourceKeyOf(rows[3] as CatalogTemplate)).toBe("builtin");
		expect(ids(select({ sources: ["src-1"] }).rows)).toEqual(["minio"]);
		expect(select({ sources: ["builtin"] }).rows).toHaveLength(5);
	});

	it("filters by what a template asks for", () => {
		expect(ids(select({ needs: [TEMPLATE_NEEDS.noSetup] }).rows)).toEqual(["whoami"]);
		expect(ids(select({ needs: [TEMPLATE_NEEDS.admin] }).rows)).toEqual(["portainer"]);
		expect(select({ needs: [TEMPLATE_NEEDS.values] }).rows).toHaveLength(5);
	});

	it("counts a facet over the rows the OTHER facets leave", () => {
		const view = select({ categories: ["Monitoring"] });
		// The category facet ignores its own selection, so the other categories
		// still show what picking them would give.
		expect(view.counts.categories.get("Databases")).toBe(1);
		expect(view.counts.categories.get("Monitoring")).toBe(2);
		// Tags, however, are counted inside the chosen category.
		expect(view.counts.tags.get("metrics")).toBe(2);
		expect(view.counts.tags.get("sql")).toBeUndefined();
	});

	it("lists every category and tag whatever is selected, for a stable rail", () => {
		const view = select({ categories: ["Databases"], query: "postgres" });
		expect(view.allCategories).toEqual(["Apps", "Databases", "Monitoring", "Storage"]);
		expect(view.allTags).toContain("docker");
	});

	it("pages, and clamps a page that no longer exists", () => {
		const first = select({}, 4);
		expect(first.visible).toHaveLength(4);
		expect(first.pageCount).toBe(2);
		expect(first.from).toBe(1);
		expect(first.to).toBe(4);

		const second = select({ page: 1 }, 4);
		expect(second.visible).toHaveLength(2);
		expect(second.from).toBe(5);
		expect(second.to).toBe(6);

		// Page 5 of a two-page list, and a narrowed filter leaving one page.
		expect(select({ page: 4 }, 4).page).toBe(1);
		expect(select({ page: 4, categories: ["Storage"] }, 4).page).toBe(0);
	});

	it("reports an empty result without pretending it has a page of rows", () => {
		const view = select({ query: "nope" }, 4);
		expect(view.visible).toEqual([]);
		expect(view.from).toBe(0);
		expect(view.to).toBe(0);
		expect(view.pageCount).toBe(1);
		expect(view.total).toBe(rows.length);
	});
});
