"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Info, LayoutGrid, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";
import { cn } from "@/lib/utils";

import { DeployTemplateDialog } from "./deploy-template-dialog";
import { TemplateDetailsDialog } from "./template-details-dialog";

export type TemplateSummary = inferRouterOutputs<AppRouter>["template"]["all"][number];

const ALL_CATEGORIES = "All";

function TemplateLogo({ template }: { template: TemplateSummary }) {
	const [failed, setFailed] = useState(false);
	if (failed || !template.logo) {
		return (
			<div className="flex size-9 items-center justify-center rounded-md bg-secondary text-base font-semibold uppercase">
				{template.name.charAt(0)}
			</div>
		);
	}
	return (
		// biome-ignore lint/performance/noImgElement: remote simple-icons CDN logo with a local fallback; next/image would need remotePatterns config
		<img
			src={`https://cdn.simpleicons.org/${template.logo}`}
			alt={`${template.name} logo`}
			className="size-9 rounded-md"
			onError={() => setFailed(true)}
		/>
	);
}

export function TemplatesView() {
	const trpc = useTRPC();
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState(ALL_CATEGORIES);
	const [selected, setSelected] = useState<TemplateSummary | null>(null);
	const [inspecting, setInspecting] = useState<TemplateSummary | null>(null);

	// The catalog is static, so cache it forever.
	const { data: templates, isPending } = useQuery({
		...trpc.template.all.queryOptions(),
		staleTime: Number.POSITIVE_INFINITY,
	});

	// Deep link (e.g. from the command palette): ?template=<id> opens the
	// deploy dialog for that template once the catalog has loaded.
	const searchParams = useSearchParams();
	const preselectId = searchParams.get("template");
	useEffect(() => {
		if (!preselectId || !templates) return;
		const match = templates.find((template) => template.id === preselectId);
		if (match) setSelected(match);
	}, [preselectId, templates]);

	// Categories in catalog order, with their template counts.
	const categories: { name: string; count: number }[] = [];
	for (const template of templates ?? []) {
		const existing = categories.find((entry) => entry.name === template.category);
		if (existing) {
			existing.count += 1;
		} else {
			categories.push({ name: template.category, count: 1 });
		}
	}

	const query = search.trim().toLowerCase();
	const filtered = templates?.filter(
		(template) =>
			(category === ALL_CATEGORIES || template.category === category) &&
			(template.name.toLowerCase().includes(query) ||
				template.description.toLowerCase().includes(query) ||
				template.tags.some((tag) => tag.toLowerCase().includes(query))),
	);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Templates"
				description="One-click deployments of popular self-hosted apps."
				actions={
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search templates..."
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							className="h-8 w-full pl-8 sm:w-56"
						/>
					</div>
				}
			/>

			{!isPending && categories.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{[ALL_CATEGORIES, ...categories.map((entry) => entry.name)].map((name) => {
						const count =
							name === ALL_CATEGORIES
								? (templates?.length ?? 0)
								: (categories.find((entry) => entry.name === name)?.count ?? 0);
						const active = category === name;
						return (
							<button
								key={name}
								type="button"
								onClick={() => setCategory(name)}
								className={cn(
									"flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
									active
										? "border-foreground bg-foreground text-background"
										: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
								)}
							>
								{name}
								<span className={cn("tabular-nums", active ? "opacity-70" : "opacity-50")}>
									{count}
								</span>
							</button>
						);
					})}
				</div>
			)}

			{isPending ? (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{["one", "two", "three", "four", "five", "six", "seven", "eight"].map((row) => (
						<div key={row} className="flex flex-col gap-3 rounded-lg border p-4">
							<Skeleton className="size-9 rounded-md" />
							<Skeleton className="h-4 w-32" />
							<Skeleton className="h-4 w-full" />
						</div>
					))}
				</div>
			) : filtered && filtered.length > 0 ? (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{filtered.map((template) => (
						<div
							key={template.id}
							className="flex flex-col gap-3 rounded-lg border p-4 transition-colors hover:bg-secondary"
						>
							<div className="flex items-center gap-3">
								<TemplateLogo template={template} />
								<div className="flex min-w-0 flex-col">
									<span className="truncate text-sm font-medium">{template.name}</span>
									<span className="truncate text-xs text-muted-foreground">
										{template.tags.join(" · ")}
									</span>
								</div>
							</div>
							<p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
								{template.description}
							</p>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									className="flex-1"
									onClick={() => setSelected(template)}
								>
									Deploy
								</Button>
								<Button
									size="sm"
									variant="outline"
									aria-label={`Details for ${template.name}`}
									title="Details"
									onClick={() => setInspecting(template)}
								>
									<Info className="size-4" />
								</Button>
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
					<LayoutGrid className="size-8 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">No templates match your filters.</p>
				</div>
			)}

			<TemplateDetailsDialog
				template={inspecting}
				onClose={() => setInspecting(null)}
				onDeploy={(template) => setSelected(template)}
			/>
			<DeployTemplateDialog template={selected} onClose={() => setSelected(null)} />
		</div>
	);
}
