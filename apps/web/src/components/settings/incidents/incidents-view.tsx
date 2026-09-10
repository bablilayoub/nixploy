"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
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
import { useTRPC } from "@/lib/trpc";

export function IncidentsView() {
	const trpc = useTRPC();
	const [projectId, setProjectId] = useState<string>("all");
	const projects = useQuery(trpc.project.all.queryOptions());
	const incidents = useQuery(
		trpc.observability.incidents.queryOptions({
			projectId: projectId === "all" ? undefined : projectId,
			limit: 100,
		}),
	);

	return (
		<SettingsStack>
			<SettingsSection
				title="Incident timeline"
				description="Deploy failures, threshold trips, watchdog events, and uptime flips."
				actions={
					<Select value={projectId} onValueChange={setProjectId}>
						<SelectTrigger className="w-48">
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
				}
			>
				<QueryState
					isPending={incidents.isPending}
					isError={incidents.isError}
					error={incidents.error}
					onRetry={() => void incidents.refetch()}
					skeleton={
						<div className="flex flex-col gap-3">
							{["a", "b", "c"].map((key) => (
								<Skeleton key={key} className="h-16 w-full" />
							))}
						</div>
					}
					isEmpty={(incidents.data ?? []).length === 0}
					empty={
						<p className="py-8 text-center text-sm text-muted-foreground">
							No incidents yet. Alerts and failed deploys will appear here.
						</p>
					}
				>
					<div className="flex flex-col gap-3">
						{(incidents.data ?? []).map((incident) => (
							<div key={incident.incidentId} className="rounded-lg border px-4 py-3 text-sm">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="font-medium">{incident.title}</p>
									<span className="text-xs text-muted-foreground">
										{format(new Date(incident.createdAt), "MMM d, HH:mm")}
									</span>
								</div>
								<p className="mt-1 text-muted-foreground">
									{incident.kind}
									{incident.serviceName ? ` · ${incident.serviceName}` : ""}
									{incident.severity ? ` · ${incident.severity}` : ""}
								</p>
								{incident.message && (
									<p className="mt-2 whitespace-pre-wrap text-muted-foreground">
										{incident.message}
									</p>
								)}
							</div>
						))}
					</div>
				</QueryState>
			</SettingsSection>

			<LogSearchSection />
		</SettingsStack>
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
