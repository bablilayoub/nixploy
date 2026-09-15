"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TableView } from "@/hooks/use-table-view";
import { cn } from "@/lib/utils";

/**
 * The search box that goes in a `TableCard` toolbar. Renders nothing while the
 * list is short — a filter over six rows is noise, not a feature.
 */
export function TableSearch<T>({
	view,
	placeholder = "Search…",
	className,
	label,
}: {
	view: TableView<T>;
	placeholder?: string;
	className?: string;
	/** Accessible name; defaults to the placeholder. */
	label?: string;
}) {
	if (!view.showSearch) return null;
	return (
		<div className={cn("relative", className)}>
			<Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input
				value={view.query}
				aria-label={label ?? placeholder}
				onChange={(event) => view.setQuery(event.target.value)}
				placeholder={placeholder}
				className="h-9 w-full ps-8 pe-8 sm:w-56"
			/>
			{view.query ? (
				<button
					type="button"
					onClick={view.clear}
					aria-label="Clear search"
					className="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<X className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}

/**
 * The pager itself, with no opinion about where the numbers come from — the
 * client-side `TableView` below and the audit log's server-side paging both
 * render this, so the panel has one pager rather than two that disagree about
 * wording and controls.
 */
export function Pagination({
	page,
	pageCount,
	from,
	to,
	total,
	noun,
	onPage,
	note,
	className,
}: {
	/** Zero-based. */
	page: number;
	pageCount: number;
	/** 1-based index of the first row shown. */
	from: number;
	/** 1-based index of the last row shown. */
	to: number;
	total: number;
	/** Plural noun for the count, e.g. "containers". */
	noun: string;
	onPage: (next: number) => void;
	/** Appended to the range, e.g. "(filtered from 120)". */
	note?: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground",
				className,
			)}
		>
			<span className="tabular-nums">
				{from}–{to} of {total} {noun}
				{note ? ` ${note}` : ""}
			</span>
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Previous page"
					disabled={page === 0}
					onClick={() => onPage(page - 1)}
				>
					<ChevronLeft className="size-3.5" />
				</Button>
				<span className="px-1 tabular-nums">
					{page + 1} / {pageCount}
				</span>
				<Button
					variant="outline"
					size="icon-sm"
					aria-label="Next page"
					disabled={page >= pageCount - 1}
					onClick={() => onPage(page + 1)}
				>
					<ChevronRight className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}

/**
 * The pager that goes in a `TableCard` footer. Like the search box it is
 * absent until the list actually overflows a page, so short tables keep their
 * current shape.
 */
export function TablePagination<T>({
	view,
	noun,
	className,
}: {
	view: TableView<T>;
	/** Plural noun for the count, e.g. "containers". */
	noun: string;
	className?: string;
}) {
	if (!view.showPagination) return null;
	return (
		<Pagination
			page={view.page}
			pageCount={view.pageCount}
			from={view.from}
			to={view.to}
			total={view.filtered.length}
			noun={noun}
			note={view.isFiltered ? `(filtered from ${view.total})` : undefined}
			onPage={view.setPage}
			className={className}
		/>
	);
}

/**
 * Row shown in place of the table body when a search matches nothing. Distinct
 * from the empty state on purpose: "no rows yet" and "no rows like that" call
 * for different next actions — and that is also why it renders nothing when the
 * box is empty. A table with no rows at all is not a failed search, and the two
 * messages would otherwise stack on top of each other.
 */
export function TableNoMatch<T>({ view, colSpan }: { view: TableView<T>; colSpan: number }) {
	if (!view.query.trim()) return null;
	return (
		<tr>
			<td colSpan={colSpan} className="p-8 text-center text-sm text-muted-foreground">
				Nothing matches “{view.query}”.{" "}
				<button
					type="button"
					onClick={view.clear}
					className="underline underline-offset-4 hover:text-foreground"
				>
					Clear search
				</button>
			</td>
		</tr>
	);
}
