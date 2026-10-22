"use client";
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TemplateLogo } from "@/components/template-logo";
import { Button } from "@/components/ui/button";
import type { TemplateEntry } from "@/lib/templates";

type CatalogEntry = Pick<
	TemplateEntry,
	"id" | "name" | "description" | "logo" | "category" | "tags"
>;
const slug = (category: string) => category.toLowerCase().replaceAll(" ", "-");
export function TemplateCatalog({
	entries,
	categories,
}: {
	entries: CatalogEntry[];
	categories: readonly string[];
}) {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState("all");
	const needle = query.trim().toLowerCase();
	const matching = entries.filter(
		(entry) =>
			(category === "all" || entry.category === category) &&
			[entry.name, entry.description, ...entry.tags].some((value) =>
				value.toLowerCase().includes(needle),
			),
	);
	const byCategory = categories
		.map((category) => ({
			category,
			id: slug(category),
			entries: matching.filter((entry) => entry.category === category),
		}))
		.filter((group) => group.entries.length > 0);
	return (
		<div className="signal-catalog-layout">
			<aside className="signal-category-rail" aria-label="Application categories">
				<p className="px-3 pb-4 text-xs font-medium">Browse the catalog</p>
				<button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
					All applications<span className="font-mono text-xs">{entries.length}</span>
				</button>
				{categories.map((value) => (
					<button
						type="button"
						key={value}
						aria-pressed={category === value}
						onClick={() => setCategory(value)}
					>
						{value}
						<span className="font-mono text-xs">
							{entries.filter((item) => item.category === value).length}
						</span>
					</button>
				))}
			</aside>
			<div className="min-w-0">
				<div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-end sm:p-5">
					<label className="grid min-w-0 flex-1 gap-2 text-sm font-medium">
						<span>Find an application</span>
						<span className="relative">
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<input
								type="search"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search names, descriptions or tags…"
								className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-base font-normal sm:text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</span>
					</label>
					<label className="grid gap-2 text-sm font-medium">
						<span>Category</span>
						<select
							value={category}
							onChange={(event) => setCategory(event.target.value)}
							className="h-11 max-w-full rounded-md border border-input bg-background px-3 text-sm font-normal focus-visible:ring-2 focus-visible:ring-ring"
						>
							<option value="all">All categories</option>
							{categories.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
				</div>
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
					<p role="status">
						{matching.length} of {entries.length} applications
					</p>
					{(query || category !== "all") && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setQuery("");
								setCategory("all");
							}}
						>
							Clear filters
						</Button>
					)}
				</div>
				{matching.length === 0 && (
					<div className="rounded-xl border border-dashed px-5 py-16 text-center">
						<h2 className="text-xl font-medium">No applications match</h2>
						<p className="mt-2 text-sm text-muted-foreground">
							Try another name or choose a broader category.
						</p>
						<Button
							variant="outline"
							className="mt-5"
							onClick={() => {
								setQuery("");
								setCategory("all");
							}}
						>
							Show all applications
						</Button>
					</div>
				)}

				{byCategory.map(({ category, id, entries }) => (
					<section key={category} id={id} className="mt-16 scroll-mt-28">
						<h2 className="text-2xl font-semibold tracking-tight">
							{category}
							<span className="ml-3 text-base font-normal text-muted-foreground">
								{entries.length}
							</span>
						</h2>
						<ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{entries.map((template) => (
								<li key={template.id}>
									<Link href={`/templates/${template.id}`} className="block h-full">
										<div className="signal-template-card">
											<div className="flex items-center gap-3">
												<TemplateLogo logo={template.logo} name={template.name} />
												<span className="min-w-0 truncate text-sm font-medium">
													{template.name}
												</span>
											</div>
											<p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
												{template.description.replaceAll("`", "")}
											</p>
										</div>
									</Link>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</div>
	);
}
