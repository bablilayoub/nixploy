"use client";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import type { ApiRouterGroup } from "@/lib/docs/api-catalog";
export function ApiExplorer({ groups }: { groups: ApiRouterGroup[] }) {
	const [query, setQuery] = useState(""),
		[method, setMethod] = useState("all");
	const needle = query.trim().toLowerCase();
	const filtered = groups
		.map((group) => ({
			...group,
			endpoints: group.endpoints.filter(
				(endpoint) =>
					(method === "all" || method === endpoint.method) &&
					`${group.title} ${group.router} ${endpoint.path} ${endpoint.summary}`
						.toLowerCase()
						.includes(needle),
			),
		}))
		.filter((group) => group.endpoints.length);
	const count = filtered.reduce((total, group) => total + group.endpoints.length, 0);
	return (
		<div className="mt-7">
			<div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
				<label htmlFor="endpoint-search" className="grid min-w-0 flex-1 gap-2 text-sm">
					<span>Find an endpoint</span>
					<span className="relative">
						<Search
							className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							id="endpoint-search"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search paths, routers or descriptions"
							className="h-11 w-full min-w-0 rounded-md border border-input bg-background pr-3 pl-9 text-base sm:text-sm"
						/>
					</span>
				</label>
				<label className="grid gap-2 text-sm">
					<span>Method</span>
					<select
						value={method}
						onChange={(event) => setMethod(event.target.value)}
						className="h-11 rounded-md border border-input bg-background px-3"
					>
						<option value="all">All methods</option>
						<option value="GET">GET</option>
						<option value="POST">POST</option>
					</select>
				</label>
			</div>
			<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
				<p className="text-xs text-muted-foreground" role="status">
					{count} endpoints across {filtered.length} routers
				</p>
				{(query || method !== "all") && (
					<button
						type="button"
						onClick={() => {
							setQuery("");
							setMethod("all");
						}}
						className="min-h-11 text-sm text-primary"
					>
						Clear endpoint filters
					</button>
				)}
			</div>
			{filtered.length === 0 ? (
				<div className="mt-4 rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
					No endpoints match. Try another path or choose all methods.
				</div>
			) : (
				<>
					<nav aria-label="Routers" className="mt-4 flex flex-wrap gap-2">
						{filtered.map((group) => (
							<a
								key={group.router}
								href={`#router-${group.router}`}
								className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 font-mono text-xs text-muted-foreground hover:text-primary"
							>
								{group.router}
								<span>{group.endpoints.length}</span>
							</a>
						))}
					</nav>
					<div className="mt-6 space-y-3">
						{filtered.map((group) => (
							<details
								key={group.router}
								id={`router-${group.router}`}
								open={needle ? true : undefined}
								className="group scroll-mt-28 overflow-hidden rounded-xl border bg-card"
							>
								<summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
									<ChevronRight
										className="size-4 shrink-0 text-primary transition-transform group-open:rotate-90"
										aria-hidden="true"
									/>
									<span className="min-w-0 flex-1">
										<span className="block font-medium">{group.title}</span>
										<span className="mt-1 block text-xs text-muted-foreground">
											{group.description}
										</span>
									</span>
									<span className="font-mono text-xs text-muted-foreground">
										{group.endpoints.length}
									</span>
								</summary>
								<section
									aria-label={`${group.title} endpoint table`}
									// biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll wide endpoint tables
									tabIndex={0}
									className="overflow-x-auto border-t"
								>
									<table className="w-full min-w-[34rem] text-left">
										<caption className="sr-only">{group.title} endpoints</caption>
										<thead className="text-xs text-muted-foreground">
											<tr>
												{["Method", "Path", "Summary", "Requires"].map((name) => (
													<th key={name} scope="col" className="px-4 py-3 font-medium">
														{name}
													</th>
												))}
											</tr>
										</thead>
										<tbody>
											{group.endpoints.map((endpoint) => (
												<tr key={endpoint.path} className="border-t text-sm">
													<td className="px-4 py-3 font-mono text-xs text-primary">
														{endpoint.method}
													</td>
													<td className="px-4 py-3 font-mono text-xs">/api/{endpoint.path}</td>
													<td className="px-4 py-3 text-muted-foreground">{endpoint.summary}</td>
													<td className="px-4 py-3 text-xs text-muted-foreground">
														{[
															...(endpoint.capability ?? []),
															...(endpoint.instanceAdmin ? ["instance admin"] : []),
														].join(", ") || "—"}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</section>
							</details>
						))}
					</div>
				</>
			)}
		</div>
	);
}
