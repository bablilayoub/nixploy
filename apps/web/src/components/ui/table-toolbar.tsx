"use client";

import { Check, ChevronLeft, ChevronRight, ListFilter, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
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
export function TableNoMatch<T>({
	view,
	colSpan,
	onClear,
}: {
	view: TableView<T>;
	colSpan: number;
	/** Also resets the facets; defaults to clearing the search alone. */
	onClear?: () => void;
}) {
	const query = view.query.trim();
	// Nothing to say about an empty table (that is the empty state's job), and
	// nothing to say while rows are showing.
	if (view.total === 0 || view.filtered.length > 0) return null;
	return (
		<tr>
			<td colSpan={colSpan} className="p-8 text-center text-sm text-muted-foreground">
				{query ? <>Nothing matches “{query}”. </> : <>No rows match these filters. </>}
				<button
					type="button"
					onClick={onClear ?? view.clear}
					className="underline underline-offset-4 hover:text-foreground"
				>
					{onClear ? "Clear filters" : "Clear search"}
				</button>
			</td>
		</tr>
	);
}

/** One value a `TableFacet` can select, with how many rows carry it. */
export interface FacetOption {
	value: string;
	label: string;
	/** Rows carrying this value under the *other* facets. Omit to hide the count. */
	count?: number;
	/** Rendered before the label — a status dot, a kind icon. */
	icon?: React.ReactNode;
}

/**
 * A multi-select filter for one column, in the shape the rest of the panel
 * already uses for pickers: a popover holding a `Command` list, searchable
 * once it is long enough to need it.
 *
 * Counts come from the caller, taken over the rows the *other* facets leave —
 * that is what makes a facet list worth reading: an option showing 0 says the
 * combination is empty before you click it, and one showing 40 says where the
 * rows are. Selecting nothing means "everything", so an untouched facet never
 * hides a row.
 */
export function TableFacet({
	label,
	options,
	selected,
	onChange,
	searchFrom = 8,
	className,
	align = "start",
}: {
	label: string;
	options: FacetOption[];
	/** Selected values; empty means no filtering by this facet. */
	selected: readonly string[];
	onChange: (next: string[]) => void;
	/** Option count from which the popover gets its own search box. */
	searchFrom?: number;
	className?: string;
	align?: "start" | "center" | "end";
}) {
	if (options.length === 0) return null;
	const chosen = new Set(selected);
	const toggle = (value: string) => {
		const next = new Set(chosen);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		onChange([...next]);
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn("h-9 border-dashed", chosen.size > 0 && "border-solid", className)}
				>
					<ListFilter className="size-3.5" />
					{label}
					{chosen.size > 0 ? (
						<>
							<Separator orientation="vertical" className="mx-0.5 h-4" />
							{/* The chosen values themselves up to two, then a count: reading
							    "Category: Databases" beats reading "Category 1". */}
							{chosen.size > 2 ? (
								<Badge variant="secondary" className="rounded-sm px-1 font-normal tabular-nums">
									{chosen.size} selected
								</Badge>
							) : (
								options
									.filter((option) => chosen.has(option.value))
									.map((option) => (
										<Badge
											key={option.value}
											variant="secondary"
											className="max-w-28 truncate rounded-sm px-1 font-normal"
										>
											{option.label}
										</Badge>
									))
							)}
						</>
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent align={align} className="w-56 p-0">
				<Command>
					{options.length >= searchFrom ? (
						<CommandInput placeholder={`Filter ${label.toLowerCase()}…`} className="h-9" />
					) : null}
					<CommandList>
						<CommandEmpty>No matches.</CommandEmpty>
						<CommandGroup>
							{options.map((option) => {
								const active = chosen.has(option.value);
								return (
									<CommandItem
										key={option.value}
										value={option.label}
										onSelect={() => toggle(option.value)}
									>
										<span
											className={cn(
												"flex size-4 shrink-0 items-center justify-center rounded-sm border",
												active
													? "border-primary bg-primary text-primary-foreground"
													: "border-input [&_svg]:invisible",
											)}
										>
											<Check className="size-3" />
										</span>
										{option.icon}
										<span className="truncate">{option.label}</span>
										{option.count !== undefined ? (
											<span className="ms-auto text-xs tabular-nums text-muted-foreground">
												{option.count}
											</span>
										) : null}
									</CommandItem>
								);
							})}
						</CommandGroup>
						{chosen.size > 0 ? (
							<>
								<CommandSeparator />
								<CommandGroup>
									<CommandItem
										onSelect={() => onChange([])}
										className="justify-center text-muted-foreground"
									>
										Clear filter
									</CommandItem>
								</CommandGroup>
							</>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * "Clear filters", shown only while something is filtered. Sits at the end of
 * a toolbar row next to the facets it resets.
 */
export function TableFilterReset({
	show,
	onClear,
	className,
}: {
	show: boolean;
	onClear: () => void;
	className?: string;
}) {
	if (!show) return null;
	return (
		<Button variant="ghost" size="sm" className={cn("h-9 px-2", className)} onClick={onClear}>
			Reset
			<X className="size-3.5" />
		</Button>
	);
}
