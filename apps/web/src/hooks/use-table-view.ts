"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Client-side search + pagination for a list the page already holds in memory.
 *
 * Deliberately *not* a generic data grid: every long list in the panel is
 * already fetched whole (Docker listings, services, schedules, runs), so the
 * only things missing were a way to find a row and a way to stop rendering four
 * hundred of them at once.
 *
 * The chrome earns its place or disappears: the search box stays hidden until a
 * list is long enough to need one (`searchFrom`) and the pager stays hidden
 * until the filtered list overflows a page. A five-row table therefore looks
 * exactly as it does today — no toolbar, no footer, nothing extra to read past.
 */
export interface TableViewOptions<T> {
	rows: T[];
	/**
	 * The fields a query matches against, as plain strings. Nullish entries are
	 * skipped, so `(row) => [row.name, row.image, row.note]` is fine.
	 */
	search: (row: T) => Array<string | null | undefined>;
	/** Rows per page. */
	pageSize?: number;
	/** Row count from which the search box appears. */
	searchFrom?: number;
}

export interface TableView<T> {
	query: string;
	setQuery: (value: string) => void;
	/** True once the unfiltered list is long enough to deserve a search box. */
	showSearch: boolean;
	/** True once the filtered list needs more than one page. */
	showPagination: boolean;
	page: number;
	setPage: (value: number) => void;
	pageCount: number;
	/** Rows of the current page — what the table body maps over. */
	visible: T[];
	/** Rows matching the query, across every page. */
	filtered: T[];
	/** Row count before filtering. */
	total: number;
	/** 1-based index of the first visible row (0 when nothing matches). */
	from: number;
	/** 1-based index of the last visible row. */
	to: number;
	/** The query is non-empty and hid at least one row. */
	isFiltered: boolean;
	clear: () => void;
}

export const DEFAULT_TABLE_PAGE_SIZE = 25;
export const DEFAULT_TABLE_SEARCH_FROM = 8;

/**
 * The whole derivation, with no React in it: filter, clamp the page, slice.
 * Split out from the hook so it can be tested directly — `apps/web` has no
 * React testing library and adding one for this would be a poor trade.
 */
export function resolveTableView<T>({
	rows,
	search,
	query,
	page,
	pageSize = DEFAULT_TABLE_PAGE_SIZE,
	searchFrom = DEFAULT_TABLE_SEARCH_FROM,
}: TableViewOptions<T> & { query: string; page: number }): Omit<
	TableView<T>,
	"setQuery" | "setPage" | "clear" | "query"
> {
	const needle = query.trim().toLowerCase();
	const filtered = needle
		? rows.filter((row) => search(row).some((field) => field?.toLowerCase().includes(needle)))
		: rows;

	const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
	// Rows vanish under the cursor — a container is removed, a filter narrows —
	// and page 7 of 3 would render an empty table with no way back.
	const safePage = Math.min(Math.max(0, page), pageCount - 1);
	const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

	return {
		showSearch: rows.length >= searchFrom,
		showPagination: filtered.length > pageSize,
		page: safePage,
		pageCount,
		visible,
		filtered,
		total: rows.length,
		from: filtered.length === 0 ? 0 : safePage * pageSize + 1,
		to: safePage * pageSize + visible.length,
		isFiltered: needle.length > 0 && filtered.length < rows.length,
	};
}

export function useTableView<T>(options: TableViewOptions<T>): TableView<T> {
	const [query, setQueryState] = useState("");
	const [page, setPage] = useState(0);

	const { rows, search, pageSize, searchFrom } = options;
	const derived = useMemo(
		() => resolveTableView({ rows, search, pageSize, searchFrom, query, page }),
		[rows, search, pageSize, searchFrom, query, page],
	);

	// Keep the stored page in step with the clamped one, so paging forward from
	// a clamped position moves by one rather than jumping back.
	useEffect(() => {
		if (page !== derived.page) setPage(derived.page);
	}, [page, derived.page]);

	return {
		...derived,
		query,
		setQuery: (value: string) => {
			setQueryState(value);
			setPage(0);
		},
		setPage,
		clear: () => {
			setQueryState("");
			setPage(0);
		},
	};
}
