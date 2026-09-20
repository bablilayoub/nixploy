"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { LayoutGrid, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { PageHeader } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/ui/table-toolbar";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";
import { cn } from "@/lib/utils";

import { DeployTemplateDialog, templateDeployBlocker } from "./deploy-template-dialog";
import { TemplateCard } from "./template-card";
import { type CatalogView, selectTemplates } from "./template-catalog";
import { TemplateDetailsDialog } from "./template-details-dialog";
import { TemplateFilterRail } from "./template-filter-rail";
import { TemplatesTable } from "./templates-table";
import type { TemplateSort } from "./use-template-filters";
import { TEMPLATE_NEEDS, useTemplateFilters } from "./use-template-filters";

export type TemplateSummary = inferRouterOutputs<AppRouter>["template"]["all"][number];

/**
 * Four columns from `xl` on purpose: most categories hold four to eight
 * templates, so a three-column grid left almost every section with one
 * stranded card on a row of its own.
 */
const GRID_CLASS = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/** A page of cards, and a page of rows. Both land just under one screenful. */
const GRID_PAGE_SIZE = 24;
const LIST_PAGE_SIZE = 25;

const SORT_LABELS: Record<TemplateSort, string> = {
	category: "By category",
	az: "Name A–Z",
	za: "Name Z–A",
	simplest: "Least setup first",
	richest: "Most setup first",
};

const NEEDS_LABELS: Record<string, string> = {
	[TEMPLATE_NEEDS.noSetup]: "No setup needed",
	[TEMPLATE_NEEDS.values]: "Asks for values",
	[TEMPLATE_NEEDS.admin]: "Instance admin",
};

/**
 * The template gallery: the query, the preselect link and the two sheets.
 * Everything visible is {@link TemplatesWorkbench}, which takes rows and
 * renders them — that split is what lets the layout be driven from a fixture
 * while the panel has no headless way to sign in.
 */
export function TemplatesView() {
	const trpc = useTRPC();
	const router = useRouter();
	const pathname = usePathname();
	const access = useCapabilities();
	const [selected, setSelected] = useState<TemplateSummary | null>(null);
	const [inspecting, setInspecting] = useState<TemplateSummary | null>(null);

	const {
		data: templates,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery({
		...trpc.template.all.queryOptions(),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const searchParams = useSearchParams();
	const preselectId = searchParams.get("template");
	useEffect(() => {
		if (!preselectId || !templates) return;
		const match = templates.find((template) => template.id === preselectId);
		if (match) setSelected(match);
	}, [preselectId, templates]);

	// Drop `?template=` when the sheet closes so picking the same template
	// again (e.g. from ⌘K) is a real navigation that re-triggers the effect.
	const closeDeploy = useCallback(() => {
		setSelected(null);
		if (searchParams.has("template")) {
			const next = new URLSearchParams(searchParams.toString());
			next.delete("template");
			const query = next.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		}
	}, [pathname, router, searchParams]);

	const blockerFor = useCallback(
		(template: TemplateSummary) => templateDeployBlocker(template, access),
		[access],
	);

	return (
		<>
			<TemplatesWorkbench
				templates={templates}
				state={{ isPending, isError, error, retry: () => refetch() }}
				deployBlocker={blockerFor}
				onInspect={setInspecting}
				onDeploy={setSelected}
			/>
			<TemplateDetailsDialog
				template={inspecting}
				onClose={() => setInspecting(null)}
				onDeploy={(template) => setSelected(template)}
			/>
			<DeployTemplateDialog template={selected} onClose={closeDeploy} />
		</>
	);
}

/**
 * The gallery itself: a faceted rail (categories, catalogs, requirements,
 * tags — each option carrying its count), a grid or a table, and every knob in
 * the URL so a narrowed view is a link.
 *
 * Paging is real, not a scroll: the built-in catalog is 145 entries and a
 * blueprints source adds four hundred more, which no single screen — and no
 * honest "all" — can hold.
 */
export function TemplatesWorkbench({
	templates,
	state,
	deployBlocker,
	onInspect,
	onDeploy,
}: {
	templates: TemplateSummary[] | undefined;
	state: {
		isPending: boolean;
		isError: boolean;
		error?: { message?: string } | null;
		retry: () => void;
	};
	deployBlocker: (template: TemplateSummary) => string | null;
	onInspect: (template: TemplateSummary) => void;
	onDeploy: (template: TemplateSummary) => void;
}) {
	const filters = useTemplateFilters();
	const [filtersOpen, setFiltersOpen] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);

	// The box keeps its own value so typing stays instant; the URL trails it.
	const [draftQuery, setDraftQuery] = useState(filters.query);
	const debouncedQuery = useDebouncedValue(draftQuery, 200);
	const setFilters = filters.set;
	useEffect(() => {
		if (debouncedQuery !== filters.query) setFilters({ query: debouncedQuery });
	}, [debouncedQuery, filters.query, setFilters]);
	// A filter reset (or the back button) has to reach the box as well.
	useEffect(() => {
		setDraftQuery((current) => (current === filters.query ? current : filters.query));
	}, [filters.query]);

	// `/` focuses the search box, the way every catalog on the web does — but
	// not while the caret is already in a field, and not over a modifier.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
			event.preventDefault();
			searchRef.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const pageSize = filters.view === "list" ? LIST_PAGE_SIZE : GRID_PAGE_SIZE;
	const view = useMemo(
		() => selectTemplates(templates ?? [], filters, pageSize),
		[templates, filters, pageSize],
	);

	const sourceNames = useMemo(() => {
		const names = new Map<string, string>();
		for (const template of templates ?? []) {
			if (template.source) names.set(template.source.templateSourceId, template.source.name);
		}
		return new Map([...names.entries()].sort(([, a], [, b]) => a.localeCompare(b)));
	}, [templates]);

	const activeChips = [
		...filters.categories.map((value) => ({
			key: `cat:${value}`,
			label: value,
			clear: () => filters.toggle("categories", value),
		})),
		...filters.sources.map((value) => ({
			key: `src:${value}`,
			label: sourceNames.get(value) ?? "Built-in",
			clear: () => filters.toggle("sources", value),
		})),
		...filters.needs.map((value) => ({
			key: `needs:${value}`,
			label: NEEDS_LABELS[value] ?? value,
			clear: () => filters.toggle("needs", value),
		})),
		...filters.tags.map((value) => ({
			key: `tag:${value}`,
			label: `#${value}`,
			clear: () => filters.toggle("tags", value),
		})),
	];

	const rail = <TemplateFilterRail view={view} filters={filters} sourceNames={sourceNames} />;

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Templates"
				description="One-click deploys for popular self-hosted apps."
				actions={
					<div className="flex items-center gap-2">
						<Select
							value={filters.sort}
							onValueChange={(value) => filters.set({ sort: value as TemplateSort })}
						>
							<SelectTrigger className="h-9 w-44" aria-label="Sort templates">
								<SelectValue />
							</SelectTrigger>
							<SelectContent align="end">
								{(Object.keys(SORT_LABELS) as TemplateSort[]).map((value) => (
									<SelectItem key={value} value={value}>
										{SORT_LABELS[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{/* Two layouts, one selection: the grid answers "what is there",
						    the table answers "which one". */}
						<div className="flex items-center rounded-md border p-0.5">
							{(
								[
									["grid", LayoutGrid, "Grid view"],
									["list", Rows3, "Table view"],
								] as const
							).map(([mode, Icon, label]) => (
								<Button
									key={mode}
									variant="ghost"
									size="icon-sm"
									aria-label={label}
									aria-pressed={filters.view === mode}
									className={cn(filters.view === mode && "bg-secondary text-foreground")}
									onClick={() => filters.set({ view: mode })}
								>
									<Icon className="size-4" />
								</Button>
							))}
						</div>
					</div>
				}
			/>

			<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
				{/* The rail is navigation, so it stays put while the results scroll. */}
				<aside className="hidden w-56 shrink-0 lg:sticky lg:top-4 lg:block">{rail}</aside>

				<div className="flex min-w-0 flex-1 flex-col gap-4">
					{/* On a phone the search box gets the row to itself: sharing it with
					    the filters button and the count squeezed it to about a hundred
					    pixels, which is not a search box. */}
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative order-1 w-full min-w-0 sm:order-none sm:w-auto sm:max-w-sm sm:flex-1">
							<Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								ref={searchRef}
								value={draftQuery}
								onChange={(event) => setDraftQuery(event.target.value)}
								placeholder="Search templates…"
								aria-label="Search templates"
								className="h-9 w-full ps-8 pe-8"
							/>
							{draftQuery ? (
								<button
									type="button"
									onClick={() => setDraftQuery("")}
									aria-label="Clear search"
									className="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
								>
									<X className="size-3.5" />
								</button>
							) : null}
						</div>

						{/* Below `lg` the rail lives in a sheet; the badge is how many
						    facets are on while it is closed. */}
						<Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
							<SheetTrigger asChild>
								<Button variant="outline" size="sm" className="order-2 h-9 lg:hidden">
									<SlidersHorizontal className="size-3.5" />
									Filters
									{activeChips.length > 0 ? (
										<Badge variant="secondary" className="rounded-sm px-1 tabular-nums">
											{activeChips.length}
										</Badge>
									) : null}
								</Button>
							</SheetTrigger>
							<SheetContent side="left" className="w-80 overflow-y-auto">
								<SheetHeader>
									<SheetTitle>Filters</SheetTitle>
								</SheetHeader>
								<div className="px-4 pb-6">{rail}</div>
							</SheetContent>
						</Sheet>

						<span className="order-3 ms-auto text-xs tabular-nums text-muted-foreground">
							{view.rows.length} of {view.total} templates
						</span>
					</div>

					{activeChips.length > 0 ? (
						<div className="flex flex-wrap items-center gap-1.5">
							{activeChips.map((chip) => (
								<button
									key={chip.key}
									type="button"
									onClick={chip.clear}
									className="flex items-center gap-1 rounded-md border bg-secondary/60 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
								>
									{chip.label}
									<X className="size-3" />
								</button>
							))}
							<Button variant="ghost" size="xs" onClick={filters.clear}>
								Clear all
							</Button>
						</div>
					) : null}

					<QueryState
						isPending={state.isPending}
						isError={state.isError}
						error={state.error}
						onRetry={state.retry}
						skeleton={
							<ul className={GRID_CLASS}>
								{["one", "two", "three", "four", "five", "six", "seven", "eight"].map((row) => (
									<li key={row} className="rounded-xl border bg-card p-4">
										<div className="flex items-center gap-2.5">
											<Skeleton className="size-9 shrink-0 rounded-lg" />
											<Skeleton className="h-4 w-28" />
										</div>
										<div className="mt-3 space-y-1.5">
											<Skeleton className="h-3 w-full" />
											<Skeleton className="h-3 w-2/3" />
										</div>
										<div className="mt-4 flex items-center justify-between">
											<Skeleton className="h-3 w-16" />
											<Skeleton className="h-8 w-16 rounded-md" />
										</div>
									</li>
								))}
							</ul>
						}
						isEmpty={view.rows.length === 0}
						empty={
							<EmptyState
								icon={LayoutGrid}
								title="No templates match"
								description="Nothing in the catalog fits every filter at once. Drop one and try again."
								action={
									filters.isFiltered ? (
										<Button variant="outline" size="sm" onClick={filters.clear}>
											Clear filters
										</Button>
									) : undefined
								}
							/>
						}
					>
						{filters.view === "list" ? (
							<div className="overflow-x-auto rounded-md border">
								<TemplatesTable
									templates={view.visible}
									onInspect={onInspect}
									onDeploy={onDeploy}
									deployBlocker={deployBlocker}
								/>
							</div>
						) : (
							<CardGrid
								view={view}
								grouped={filters.sort === "category"}
								onInspect={onInspect}
								onDeploy={onDeploy}
								deployBlocker={deployBlocker}
								onTag={(tag) => filters.toggle("tags", tag)}
							/>
						)}

						{view.pageCount > 1 ? (
							<Pagination
								className="pt-4"
								page={view.page}
								pageCount={view.pageCount}
								from={view.from}
								to={view.to}
								total={view.rows.length}
								noun="templates"
								note={filters.isFiltered ? `(filtered from ${view.total})` : undefined}
								onPage={(next) => {
									filters.set({ page: next });
									window.scrollTo({ top: 0, behavior: "smooth" });
								}}
							/>
						) : null}
					</QueryState>
				</div>
			</div>
		</div>
	);
}

/**
 * The grid, with a category rule inserted wherever the category changes.
 *
 * That only happens under the category sort, where the rows are already
 * grouped — the rule then labels a run that exists rather than inventing one,
 * and it keeps working across pages, which a "group everything" layout cannot.
 */
function CardGrid({
	view,
	grouped,
	onInspect,
	onDeploy,
	deployBlocker,
	onTag,
}: {
	view: CatalogView<TemplateSummary>;
	grouped: boolean;
	onInspect: (template: TemplateSummary) => void;
	onDeploy: (template: TemplateSummary) => void;
	deployBlocker: (template: TemplateSummary) => string | null;
	onTag: (tag: string) => void;
}) {
	if (!grouped) {
		return (
			<ul className={GRID_CLASS}>
				{view.visible.map((template) => (
					<li key={template.id}>
						<TemplateCard
							template={template}
							deployBlocker={deployBlocker(template)}
							onInspect={() => onInspect(template)}
							onDeploy={() => onDeploy(template)}
							onTag={onTag}
						/>
					</li>
				))}
			</ul>
		);
	}

	const sections: Array<{ category: string; rows: TemplateSummary[] }> = [];
	for (const template of view.visible) {
		const last = sections.at(-1);
		if (last?.category === template.category) last.rows.push(template);
		else sections.push({ category: template.category, rows: [template] });
	}

	return (
		<div className="flex flex-col gap-8">
			{sections.map((section) => (
				<section key={section.category} className="space-y-3">
					{/* The rule carries the eye from the label across to the row it
					    labels, which is what separates the sections — not the gap. */}
					<div className="flex items-center gap-3">
						<h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							{section.category}
						</h2>
						<span className="text-[11px] tabular-nums text-muted-foreground/60">
							{view.counts.categories.get(section.category) ?? section.rows.length}
						</span>
						<span aria-hidden className="h-px flex-1 bg-border" />
					</div>
					<ul className={GRID_CLASS}>
						{section.rows.map((template) => (
							<li key={template.id}>
								<TemplateCard
									template={template}
									deployBlocker={deployBlocker(template)}
									onInspect={() => onInspect(template)}
									onDeploy={() => onDeploy(template)}
									onTag={onTag}
								/>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
