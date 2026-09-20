"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * Gallery state, kept in the URL.
 *
 * Every knob on the templates page is a query parameter, so a narrowed view is
 * a link: "the two database templates from the platform catalog that need no
 * setup" can be pasted into an issue. It also means the browser's back button
 * steps through filters, and a reload does not drop them.
 *
 * `?template=` is NOT ours — it preselects a template for the deploy sheet
 * (the palette links to it) — so every write preserves the parameters it does
 * not own rather than replacing the query wholesale.
 */

export type TemplateSort = "category" | "az" | "za" | "simplest" | "richest";
export type TemplateViewMode = "grid" | "list";

/** Requirement facet values. */
export const TEMPLATE_NEEDS = {
	/** The deploy form asks for nothing. */
	noSetup: "no-setup",
	/** The deploy form asks for at least one value. */
	values: "values",
	/** Host access or published ports: the instance admin deploys it. */
	admin: "admin",
} as const;

export interface TemplateFilters {
	query: string;
	categories: string[];
	tags: string[];
	/** `builtin`, or a template source id. */
	sources: string[];
	/** Values of {@link TEMPLATE_NEEDS}. */
	needs: string[];
	sort: TemplateSort;
	view: TemplateViewMode;
	/** Zero-based. */
	page: number;
}

const SORTS: TemplateSort[] = ["category", "az", "za", "simplest", "richest"];

const readList = (params: URLSearchParams, key: string): string[] => {
	const raw = params.get(key);
	if (!raw) return [];
	// Repeated keys and one comma-separated key both work; the writer emits the
	// comma form so a link with four tags stays readable.
	return [...new Set([...params.getAll(key), ...raw.split(",")].flatMap((v) => v.split(",")))]
		.map((value) => value.trim())
		.filter(Boolean);
};

export interface TemplateFilterState extends TemplateFilters {
	/** Anything other than the sort and the view mode is set. */
	isFiltered: boolean;
	set: (patch: Partial<TemplateFilters>) => void;
	toggle: (key: "categories" | "tags" | "sources" | "needs", value: string) => void;
	clear: () => void;
}

export function useTemplateFilters(): TemplateFilterState {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const filters = useMemo<TemplateFilters>(() => {
		const sort = searchParams.get("sort") as TemplateSort | null;
		const page = Number.parseInt(searchParams.get("page") ?? "", 10);
		return {
			query: searchParams.get("q") ?? "",
			categories: readList(searchParams, "cat"),
			tags: readList(searchParams, "tag"),
			sources: readList(searchParams, "src"),
			needs: readList(searchParams, "needs"),
			sort: sort && SORTS.includes(sort) ? sort : "category",
			view: searchParams.get("view") === "list" ? "list" : "grid",
			page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
		};
	}, [searchParams]);

	const write = useCallback(
		(patch: Partial<TemplateFilters>) => {
			const next = new URLSearchParams(searchParams.toString());
			const put = (key: string, value: string | string[] | undefined, fallback: string) => {
				if (value === undefined) return;
				const text = Array.isArray(value) ? value.join(",") : value;
				if (!text || text === fallback) next.delete(key);
				else next.set(key, text);
			};
			put("q", patch.query, "");
			put("cat", patch.categories, "");
			put("tag", patch.tags, "");
			put("src", patch.sources, "");
			put("needs", patch.needs, "");
			put("sort", patch.sort, "category");
			put("view", patch.view, "grid");
			// Any change to what is listed puts the reader back on the first page;
			// only an explicit page move keeps one.
			if (patch.page === undefined || Object.keys(patch).some((key) => key !== "page")) {
				next.delete("page");
			}
			if (patch.page !== undefined && patch.page > 0) next.set("page", String(patch.page + 1));
			const query = next.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		},
		[pathname, router, searchParams],
	);

	const toggle = useCallback(
		(key: "categories" | "tags" | "sources" | "needs", value: string) => {
			const current = filters[key];
			write({
				[key]: current.includes(value)
					? current.filter((entry) => entry !== value)
					: [...current, value],
			});
		},
		[filters, write],
	);

	const clear = useCallback(() => {
		write({ query: "", categories: [], tags: [], sources: [], needs: [] });
	}, [write]);

	return {
		...filters,
		isFiltered:
			filters.query.trim().length > 0 ||
			filters.categories.length > 0 ||
			filters.tags.length > 0 ||
			filters.sources.length > 0 ||
			filters.needs.length > 0,
		set: write,
		toggle,
		clear,
	};
}
