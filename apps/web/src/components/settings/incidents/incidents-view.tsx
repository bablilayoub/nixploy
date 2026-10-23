"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { StatusPageCard } from "@/components/monitoring/status-page-card";
import { QueryState } from "@/components/query-state";
import { PageHeader } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { IncidentWorkbench } from "./incident-workbench";

export function IncidentsView({ embedded = false }: { embedded?: boolean } = {}) {
	const trpc = useTRPC();
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const projectId = params.get("incidentProject") ?? "all";
	const rawState = params.get("incidentState");
	const state = rawState === "resolved" || rawState === "all" ? rawState : "open";
	const selectedId = params.get("incident");
	const update = (key: string, value: string | null) => {
		const next = new URLSearchParams(params.toString());
		if (value) next.set(key, value);
		else next.delete(key);
		router.replace(`${pathname}?${next.toString()}`, { scroll: false });
	};
	const projects = useQuery(trpc.project.all.queryOptions());
	const incidents = useInfiniteQuery(
		trpc.observability.incidentPage.infiniteQueryOptions(
			{
				projectId: projectId === "all" ? undefined : projectId,
				state,
				limit: 30,
			},
			{ getNextPageParam: (page) => page.nextCursor },
		),
	);
	const rows = incidents.data?.pages.flatMap((page) => page.incidents) ?? [];
	return (
		<div className="flex flex-col gap-8">
			{!embedded && (
				<PageHeader
					title="Incidents"
					description="Investigate failures, follow recovery and record what you verified."
				/>
			)}
			<SettingsStack>
				<SettingsSection
					title="Incident workspace"
					description="Starting a recovery leaves the incident open until you verify the result."
					bare
					actions={
						<div className="flex flex-wrap gap-2">
							<Select value={state} onValueChange={(value) => update("incidentState", value)}>
								<SelectTrigger className="w-40" aria-label="Incident state">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="open">Open</SelectItem>
									<SelectItem value="resolved">Resolved</SelectItem>
									<SelectItem value="all">All incidents</SelectItem>
								</SelectContent>
							</Select>
							<Select value={projectId} onValueChange={(value) => update("incidentProject", value)}>
								<SelectTrigger className="w-44" aria-label="Incident project">
									<SelectValue placeholder="All projects" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All projects</SelectItem>
									{(projects.data ?? []).map((project) => (
										<SelectItem key={project.projectId} value={project.projectId}>
											{project.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					}
				>
					<div className="grid items-start gap-4 xl:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.6fr)]">
						<div className="min-w-0">
							<div className="mb-3 text-xs text-muted-foreground">
								{incidents.data?.pages[0]?.openCount ?? "—"} open in this scope
							</div>
							<QueryState
								isPending={incidents.isPending}
								isError={incidents.isError}
								error={incidents.error}
								onRetry={() => void incidents.refetch()}
								isEmpty={rows.length === 0}
								empty={
									<div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
										{state === "open"
											? "No open incidents in this scope. Resolved incidents remain available in the filter."
											: "No incidents match these filters."}
									</div>
								}
								skeleton={<Skeleton className="h-48 w-full" />}
							>
								<ul className="divide-y overflow-hidden rounded-lg border">
									{rows.map((incident) => (
										<li key={incident.incidentId}>
											<Button
												variant="ghost"
												size="sm"
												type="button"
												onClick={() => update("incident", incident.incidentId)}
												aria-pressed={selectedId === incident.incidentId}
												className={cn(
													"flex w-full flex-col items-stretch justify-start rounded-none font-normal gap-2 px-4 py-3 text-left hover:bg-accent/50",
													selectedId === incident.incidentId && "bg-secondary",
												)}
											>
												<span className="flex items-start justify-between gap-2">
													<span className="min-w-0 break-words text-sm font-medium">
														{incident.title}
													</span>
													<ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
												</span>
												<span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
													<Badge variant={incident.resolvedAt ? "secondary" : "outline"}>
														{incident.resolvedAt
															? "Resolved"
															: incident.acknowledgedAt
																? "Acknowledged"
																: "Open"}
													</Badge>
													<span>{incident.serviceName ?? incident.kind}</span>
													<DateTime value={incident.createdAt} />
												</span>
											</Button>
										</li>
									))}
								</ul>
								{incidents.hasNextPage && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="mt-3"
										disabled={incidents.isFetchingNextPage}
										onClick={() => void incidents.fetchNextPage()}
									>
										{incidents.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />}
										Load older incidents
									</Button>
								)}
							</QueryState>
						</div>
						{selectedId ? (
							<IncidentWorkbench
								key={selectedId}
								incidentId={selectedId}
								onClose={() => update("incident", null)}
							/>
						) : (
							<div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
								Select an incident to inspect its evidence and recovery options.
							</div>
						)}
					</div>
				</SettingsSection>
				<StatusPageCard />
				<LogSearchSection />
			</SettingsStack>
		</div>
	);
}

function LogSearchSection() {
	const trpc = useTRPC();
	const [query, setQuery] = useState("");
	const [submitted, setSubmitted] = useState("");
	const results = useQuery({
		...trpc.observability.searchLogs.queryOptions({ query: submitted, limit: 30 }),
		enabled: submitted.length > 0,
	});

	return (
		<SettingsSection
			title="Log search"
			description="Search indexed deployment logs (Postgres tsvector). Failed deploys are ingested automatically."
		>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					setSubmitted(query.trim());
				}}
			>
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search logs…"
					aria-label="Search log messages"
				/>
			</form>
			{submitted && results.isLoading && <Skeleton className="h-20 w-full" />}
			{submitted && results.isError && (
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<span className="text-destructive">Search failed: {results.error.message}</span>
					<Button variant="outline" size="sm" onClick={() => void results.refetch()}>
						Retry
					</Button>
				</div>
			)}
			{submitted && !results.isLoading && !results.isError && (results.data ?? []).length === 0 && (
				<p className="text-sm text-muted-foreground">No matches.</p>
			)}
			{(results.data ?? []).map((row) => (
				<pre
					key={row.serviceLogId}
					className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap"
				>
					{row.body.slice(0, 2000)}
				</pre>
			))}
		</SettingsSection>
	);
}
