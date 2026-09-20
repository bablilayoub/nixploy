"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CatalogView } from "./template-catalog";
import { BUILT_IN_SOURCE } from "./template-catalog";
import type { TemplateSummary } from "./templates-view";
import type { TemplateFilterState } from "./use-template-filters";
import { TEMPLATE_NEEDS } from "./use-template-filters";

/**
 * The filter rail: categories, catalogs, requirements and tags, each option
 * carrying how many templates it would leave.
 *
 * The counts are the point. A category list without them is a list of guesses;
 * with them it is a map of the catalog, and an option reading 0 says the
 * combination is empty before you spend a click on it. They come from
 * `selectTemplates`, which counts each facet over the rows the *other* facets
 * leave — so picking "Databases" does not zero every other category.
 *
 * Rendered in the page's sidebar from `lg`, and inside a sheet below it.
 */

/** How many tags to print before "Show all". */
const TAG_PREVIEW = 12;

function FacetRow({
	label,
	count,
	active,
	onClick,
}: {
	label: string;
	count: number;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors",
				active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
				count === 0 && !active ? "opacity-50" : "hover:bg-accent hover:text-foreground",
			)}
		>
			<span className="truncate">{label}</span>
			<span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">{count}</span>
		</button>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
				{title}
			</h3>
			{children}
		</div>
	);
}

export function TemplateFilterRail({
	view,
	filters,
	sourceNames,
}: {
	view: CatalogView<TemplateSummary>;
	filters: TemplateFilterState;
	/** Source id → catalog name, for the catalogs facet. */
	sourceNames: Map<string, string>;
}) {
	const [allTags, setAllTags] = useState(false);

	const tags = [...view.counts.tags.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.filter(([tag]) => view.counts.tags.get(tag) !== 0 || filters.tags.includes(tag));
	const visibleTags = allTags ? tags : tags.slice(0, TAG_PREVIEW);

	const needs = [
		{ value: TEMPLATE_NEEDS.noSetup, label: "No setup needed" },
		{ value: TEMPLATE_NEEDS.values, label: "Asks for values" },
		{ value: TEMPLATE_NEEDS.admin, label: "Instance admin" },
	];

	return (
		<div className="flex flex-col gap-5">
			<Section title="Categories">
				<FacetRow
					label="All categories"
					count={view.total}
					active={filters.categories.length === 0}
					onClick={() => filters.set({ categories: [] })}
				/>
				{view.allCategories.map((category) => (
					<FacetRow
						key={category}
						label={category}
						count={view.counts.categories.get(category) ?? 0}
						active={filters.categories.includes(category)}
						onClick={() => filters.toggle("categories", category)}
					/>
				))}
			</Section>

			{/* One catalog means one row that always reads the total — the facet
			    only earns its space once a source has been added. */}
			{view.counts.sources.size > 1 || sourceNames.size > 0 ? (
				<Section title="Catalogs">
					<FacetRow
						label="Built-in"
						count={view.counts.sources.get(BUILT_IN_SOURCE) ?? 0}
						active={filters.sources.includes(BUILT_IN_SOURCE)}
						onClick={() => filters.toggle("sources", BUILT_IN_SOURCE)}
					/>
					{[...sourceNames.entries()].map(([id, name]) => (
						<FacetRow
							key={id}
							label={name}
							count={view.counts.sources.get(id) ?? 0}
							active={filters.sources.includes(id)}
							onClick={() => filters.toggle("sources", id)}
						/>
					))}
				</Section>
			) : null}

			<Section title="Requirements">
				{needs.map((need) => (
					<FacetRow
						key={need.value}
						label={need.label}
						count={view.counts.needs.get(need.value) ?? 0}
						active={filters.needs.includes(need.value)}
						onClick={() => filters.toggle("needs", need.value)}
					/>
				))}
			</Section>

			{tags.length > 0 ? (
				<Section title="Tags">
					<div className="flex flex-wrap gap-1 px-2 pt-1">
						{visibleTags.map(([tag, count]) => {
							const active = filters.tags.includes(tag);
							return (
								<button
									key={tag}
									type="button"
									aria-pressed={active}
									onClick={() => filters.toggle("tags", tag)}
									className={cn(
										"rounded-md border px-1.5 py-0.5 text-xs transition-colors",
										active
											? "border-foreground/30 bg-secondary text-foreground"
											: "text-muted-foreground hover:border-foreground/20 hover:text-foreground",
									)}
								>
									{tag}
									<span className="ms-1 tabular-nums text-muted-foreground/60">{count}</span>
								</button>
							);
						})}
					</div>
					{tags.length > TAG_PREVIEW ? (
						<Button
							variant="link"
							className="h-auto w-fit px-2 py-1 text-xs"
							onClick={() => setAllTags((value) => !value)}
						>
							{allTags ? "Show fewer tags" : `Show all ${tags.length} tags`}
						</Button>
					) : null}
				</Section>
			) : null}
		</div>
	);
}
