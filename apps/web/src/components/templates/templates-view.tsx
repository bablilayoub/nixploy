"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowDownAZ, ArrowUpAZ, LayoutGrid } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

import { DeployTemplateDialog, templateDeployBlocker } from "./deploy-template-dialog";
import { TemplateDetailsDialog } from "./template-details-dialog";
import { TemplateLogo } from "./template-logo";

export type TemplateSummary = inferRouterOutputs<AppRouter>["template"]["all"][number];

const ALL_CATEGORIES = "all";

/**
 * Shared by the skeleton and both result layouts so they cannot drift apart.
 * Four columns from `xl` on purpose: most categories hold four to eight
 * templates, so a three-column grid left almost every section with one
 * stranded card on a row of its own.
 */
const GRID_CLASS = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/**
 * One gallery entry.
 *
 * The whole card is the "open details" target — a stretched transparent button
 * rather than a wrapper `<button>`, so the Deploy button can sit inside it
 * without nesting one interactive element in another. Deploy is raised above
 * that overlay with `z-10`; everything else is inert text.
 *
 * Deliberately NOT here: a second "Details" button (it did exactly what
 * clicking the card does) and the tag list (the tags mostly restate the
 * category heading above the grid — they stay searchable, just not printed on
 * every card). What replaced them is the one fact you want before committing:
 * how many values the deploy form will ask for.
 */
function TemplateCard({
	template,
	onInspect,
	onDeploy,
	deployBlocker,
}: {
	template: TemplateSummary;
	onInspect: () => void;
	onDeploy: () => void;
	/** Reason the caller cannot deploy (disables the button), or null. */
	deployBlocker: string | null;
}) {
	const settingsCount = template.env.length;
	return (
		<article className="group relative flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40">
			<div className="flex items-center gap-2.5">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
					<TemplateLogo name={template.name} logo={template.logo} />
				</div>
				<h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
					{template.name}
				</h3>
				{/* Which catalog this came from: the built-ins carry no source. */}
				{template.source ? (
					<Badge variant="secondary" className="max-w-28 shrink-0 truncate font-normal">
						{template.source.name}
					</Badge>
				) : template.hostPrivileged ? (
					<Badge variant="outline" className="shrink-0 font-normal">
						Instance admin
					</Badge>
				) : null}
			</div>

			{/* Two lines, always — reserving the height keeps every row of the grid
			    on the same baseline whether a description is 6 words or 30. */}
			<p className="mt-3 line-clamp-2 min-h-9 text-xs leading-[1.125rem] text-muted-foreground">
				{template.description}
			</p>

			<div className="mt-4 flex items-end justify-between gap-2 pt-0.5">
				<span className="text-[11px] text-muted-foreground/80">
					{settingsCount === 0
						? "No setup needed"
						: `${settingsCount} ${settingsCount === 1 ? "setting" : "settings"}`}
				</span>
				{/* Quiet until the card is engaged, then it reads as the primary action.
				    The stacked `group-hover:hover:` is not redundant: the button's own
				    `hover:bg-secondary/80` would otherwise fight `group-hover:bg-primary`
				    at the moment the pointer is actually on the button. */}
				<Button
					size="sm"
					variant="secondary"
					className="relative z-10 group-hover:bg-primary group-hover:text-primary-foreground group-hover:hover:bg-primary/90"
					onClick={onDeploy}
					disabled={deployBlocker !== null}
					title={deployBlocker ?? undefined}
				>
					Deploy
				</Button>
			</div>

			<button
				type="button"
				onClick={onInspect}
				className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="sr-only">{template.name} details</span>
			</button>
		</article>
	);
}

export function TemplatesView() {
	const trpc = useTRPC();
	const router = useRouter();
	const pathname = usePathname();
	const access = useCapabilities();
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState(ALL_CATEGORIES);
	const [sort, setSort] = useState<"asc" | "desc">("asc");
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

	const categories = useMemo(() => {
		const names: string[] = [];
		for (const template of templates ?? []) {
			if (!names.includes(template.category)) names.push(template.category);
		}
		return names.sort((a, b) => a.localeCompare(b));
	}, [templates]);

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		const rows = (templates ?? []).filter(
			(template) =>
				(category === ALL_CATEGORIES || template.category === category) &&
				(template.name.toLowerCase().includes(query) ||
					template.description.toLowerCase().includes(query) ||
					template.tags.some((tag) => tag.toLowerCase().includes(query))),
		);
		return rows.sort((a, b) =>
			sort === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
		);
	}, [templates, category, search, sort]);

	const grouped = useMemo(() => {
		if (category !== ALL_CATEGORIES) return null;
		const map = new Map<string, TemplateSummary[]>();
		for (const template of filtered) {
			const list = map.get(template.category) ?? [];
			list.push(template);
			map.set(template.category, list);
		}
		return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [filtered, category]);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader title="Templates" description="One-click deploys for popular self-hosted apps." />

			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
					<Input
						placeholder="Search templates…"
						aria-label="Search templates"
						className="h-9 w-full sm:max-w-xs"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					<Select value={category} onValueChange={setCategory}>
						<SelectTrigger className="h-9 w-full sm:w-44">
							<SelectValue placeholder="Category" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
							{categories.map((name) => (
								<SelectItem key={name} value={name}>
									{name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<Select value={sort} onValueChange={(value) => setSort(value as "asc" | "desc")}>
					<SelectTrigger className="h-9 w-full sm:w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent align="end">
						<SelectItem value="asc">
							<span className="flex items-center gap-2">
								<ArrowUpAZ className="size-4" />
								A–Z
							</span>
						</SelectItem>
						<SelectItem value="desc">
							<span className="flex items-center gap-2">
								<ArrowDownAZ className="size-4" />
								Z–A
							</span>
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<QueryState
				isPending={isPending}
				isError={isError}
				error={error}
				onRetry={() => refetch()}
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
				isEmpty={filtered.length === 0}
				empty={
					<EmptyState
						icon={LayoutGrid}
						title="No templates match"
						description="Try a different search or category."
					/>
				}
			>
				{grouped ? (
					<div className="flex flex-col gap-8">
						{grouped.map(([categoryName, rows]) => (
							<section key={categoryName} className="space-y-3">
								{/* The rule carries the eye from the label across to the row it
								    labels, which is what separates the sections — not the gap. */}
								<div className="flex items-center gap-3">
									<h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
										{categoryName}
									</h2>
									<span className="text-[11px] tabular-nums text-muted-foreground/60">
										{rows.length}
									</span>
									<span aria-hidden className="h-px flex-1 bg-border" />
								</div>
								<ul className={GRID_CLASS}>
									{rows.map((template) => (
										<li key={template.id}>
											<TemplateCard
												template={template}
												deployBlocker={templateDeployBlocker(template, access)}
												onInspect={() => setInspecting(template)}
												onDeploy={() => setSelected(template)}
											/>
										</li>
									))}
								</ul>
							</section>
						))}
					</div>
				) : (
					<ul className={GRID_CLASS}>
						{filtered.map((template) => (
							<li key={template.id}>
								<TemplateCard
									template={template}
									deployBlocker={templateDeployBlocker(template, access)}
									onInspect={() => setInspecting(template)}
									onDeploy={() => setSelected(template)}
								/>
							</li>
						))}
					</ul>
				)}
			</QueryState>

			<TemplateDetailsDialog
				template={inspecting}
				onClose={() => setInspecting(null)}
				onDeploy={(template) => setSelected(template)}
			/>
			<DeployTemplateDialog template={selected} onClose={closeDeploy} />
		</div>
	);
}
