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
	return (
		<article className="group flex h-full flex-col rounded-lg border border-border transition-colors hover:border-foreground/20">
			<button type="button" onClick={onInspect} className="flex flex-1 flex-col p-4 text-left">
				<div className="flex items-start gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border">
						<TemplateLogo name={template.name} logo={template.logo} />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-start justify-between gap-2">
							<h3 className="truncate text-sm font-medium text-foreground">{template.name}</h3>
							{template.hostPrivileged ? (
								<Badge variant="outline" className="shrink-0 text-[11px] font-normal">
									Instance admin
								</Badge>
							) : (
								<span className="sr-only">{template.category}</span>
							)}
						</div>
						<p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
							{template.description}
						</p>
					</div>
				</div>
			</button>
			<div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
				<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onInspect}>
					Details
				</Button>
				<Button
					size="sm"
					onClick={onDeploy}
					disabled={deployBlocker !== null}
					title={deployBlocker ?? undefined}
				>
					Deploy
				</Button>
			</div>
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
					<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{["one", "two", "three", "four", "five", "six"].map((row) => (
							<li key={row} className="rounded-lg border p-4">
								<div className="flex gap-3">
									<Skeleton className="size-10 shrink-0 rounded-md" />
									<div className="min-w-0 flex-1 space-y-2">
										<Skeleton className="h-4 w-28" />
										<Skeleton className="h-3 w-full" />
									</div>
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
								<div className="flex items-center gap-2">
									<h2 className="text-sm font-medium capitalize">{categoryName}</h2>
									<Badge variant="secondary" className="font-normal tabular-nums">
										{rows.length}
									</Badge>
								</div>
								<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
					<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
