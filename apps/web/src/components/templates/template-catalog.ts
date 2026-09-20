import type { TemplateFilters } from "./use-template-filters";
import { TEMPLATE_NEEDS } from "./use-template-filters";

/**
 * The gallery's filtering, sorting and facet counting, with no React in it so
 * it can be tested directly (`apps/web` has no React testing library, and the
 * interesting behaviour is all here rather than in the markup).
 *
 * Two rules the counts depend on. A facet ORs its own values — picking two
 * categories widens the result — and ANDs against the other facets, which is
 * what people expect from a faceted catalog. And a facet's counts are taken
 * over the rows the *other* facets leave, never over the rows it filtered
 * itself: otherwise every unselected option in the facet you are looking at
 * reads 0 as soon as you pick one.
 */

/** The fields of a template the gallery reads. Structural on purpose: the */
/** router's output type carries much more, and the tests build small rows. */
export interface CatalogTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	tags: string[];
	env: unknown[];
	hostPrivileged?: boolean;
	publishPorts?: boolean;
	source?: { templateSourceId: string; name: string } | null;
}

export const BUILT_IN_SOURCE = "builtin";

export const sourceKeyOf = (template: CatalogTemplate): string =>
	template.source?.templateSourceId ?? BUILT_IN_SOURCE;

export const needsInstanceAdmin = (template: CatalogTemplate): boolean =>
	Boolean(template.hostPrivileged || template.publishPorts);

/** Which requirement values a template carries. */
function needsOf(template: CatalogTemplate): string[] {
	const values: string[] = [];
	values.push(template.env.length === 0 ? TEMPLATE_NEEDS.noSetup : TEMPLATE_NEEDS.values);
	if (needsInstanceAdmin(template)) values.push(TEMPLATE_NEEDS.admin);
	return values;
}

function matchesQuery(template: CatalogTemplate, needle: string): boolean {
	if (!needle) return true;
	return (
		template.name.toLowerCase().includes(needle) ||
		template.description.toLowerCase().includes(needle) ||
		template.category.toLowerCase().includes(needle) ||
		template.id.toLowerCase().includes(needle) ||
		template.tags.some((tag) => tag.toLowerCase().includes(needle))
	);
}

/** Which facet to leave out, when counting that facet's own options. */
type Facet = "categories" | "tags" | "sources" | "needs";

function matches(
	template: CatalogTemplate,
	filters: TemplateFilters,
	except?: Facet | "query",
): boolean {
	if (except !== "query" && !matchesQuery(template, filters.query.trim().toLowerCase())) {
		return false;
	}
	if (
		except !== "categories" &&
		filters.categories.length > 0 &&
		!filters.categories.includes(template.category)
	) {
		return false;
	}
	if (
		except !== "tags" &&
		filters.tags.length > 0 &&
		!template.tags.some((tag) => filters.tags.includes(tag))
	) {
		return false;
	}
	if (
		except !== "sources" &&
		filters.sources.length > 0 &&
		!filters.sources.includes(sourceKeyOf(template))
	) {
		return false;
	}
	if (except !== "needs" && filters.needs.length > 0) {
		const values = needsOf(template);
		if (!values.some((value) => filters.needs.includes(value))) return false;
	}
	return true;
}

const byName = (a: CatalogTemplate, b: CatalogTemplate) => a.name.localeCompare(b.name);

function sortRows<T extends CatalogTemplate>(rows: T[], sort: TemplateFilters["sort"]): T[] {
	const sorted = [...rows];
	switch (sort) {
		case "az":
			return sorted.sort(byName);
		case "za":
			return sorted.sort((a, b) => byName(b, a));
		case "simplest":
			return sorted.sort((a, b) => a.env.length - b.env.length || byName(a, b));
		case "richest":
			return sorted.sort((a, b) => b.env.length - a.env.length || byName(a, b));
		default:
			return sorted.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));
	}
}

function countValues<T extends CatalogTemplate>(
	rows: T[],
	filters: TemplateFilters,
	facet: Facet,
	valuesOf: (template: T) => string[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const template of rows) {
		if (!matches(template, filters, facet)) continue;
		for (const value of valuesOf(template)) {
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
	}
	return counts;
}

export interface CatalogView<T extends CatalogTemplate> {
	/** Rows matching every facet, sorted. */
	rows: T[];
	/** The current page of {@link rows}. */
	visible: T[];
	page: number;
	pageCount: number;
	/** 1-based index of the first and last visible row (0 when empty). */
	from: number;
	to: number;
	total: number;
	counts: {
		categories: Map<string, number>;
		tags: Map<string, number>;
		sources: Map<string, number>;
		needs: Map<string, number>;
	};
	/** Every category and tag in the catalog, so an empty facet still lists them. */
	allCategories: string[];
	allTags: string[];
}

export function selectTemplates<T extends CatalogTemplate>(
	templates: T[],
	filters: TemplateFilters,
	pageSize: number,
): CatalogView<T> {
	const rows = sortRows(
		templates.filter((template) => matches(template, filters)),
		filters.sort,
	);
	const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
	// The page can outlive the filter that made it reachable (a narrower facet,
	// a source removed) — clamp rather than render an empty page.
	const page = Math.min(Math.max(0, filters.page), pageCount - 1);
	const visible = rows.slice(page * pageSize, page * pageSize + pageSize);

	const categories = new Set<string>();
	const tags = new Set<string>();
	for (const template of templates) {
		categories.add(template.category);
		for (const tag of template.tags) tags.add(tag);
	}

	return {
		rows,
		visible,
		page,
		pageCount,
		from: rows.length === 0 ? 0 : page * pageSize + 1,
		to: page * pageSize + visible.length,
		total: templates.length,
		counts: {
			categories: countValues(templates, filters, "categories", (t) => [t.category]),
			tags: countValues(templates, filters, "tags", (t) => t.tags),
			sources: countValues(templates, filters, "sources", (t) => [sourceKeyOf(t)]),
			needs: countValues(templates, filters, "needs", needsOf),
		},
		allCategories: [...categories].sort((a, b) => a.localeCompare(b)),
		allTags: [...tags].sort((a, b) => a.localeCompare(b)),
	};
}
