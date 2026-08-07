"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
					<div>
						<CardTitle className="text-sm font-medium">Incident timeline</CardTitle>
						<CardDescription>
							Deploy failures, threshold trips, watchdog events, and uptime flips.
						</CardDescription>
					</div>
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
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					{incidents.isLoading ? (
						["a", "b", "c"].map((key) => <Skeleton key={key} className="h-16 w-full" />)
					) : incidents.isError ? (
						<div className="flex flex-col items-center gap-2 py-8 text-center">
							<p className="text-sm font-medium">Could not load incidents</p>
							<p className="text-sm text-muted-foreground">
								{incidents.error.message || "Try again in a moment."}
							</p>
							<Button variant="outline" size="sm" onClick={() => void incidents.refetch()}>
								Retry
							</Button>
						</div>
					) : (incidents.data ?? []).length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							No incidents yet. Alerts and failed deploys will appear here.
						</p>
					) : (
						(incidents.data ?? []).map((incident) => (
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
						))
					)}
				</CardContent>
			</Card>

			<LogSearchCard />
		</div>
	);
}

function LogSearchCard() {
	const trpc = useTRPC();
	const [query, setQuery] = useState("");
	const [submitted, setSubmitted] = useState("");
	const results = useQuery({
		...trpc.observability.searchLogs.queryOptions({ query: submitted, limit: 30 }),
		enabled: submitted.length > 0,
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">Log search</CardTitle>
				<CardDescription>
					Search indexed deployment logs (Postgres tsvector). Failed deploys are ingested
					automatically.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
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
				{submitted && !results.isLoading && (results.data ?? []).length === 0 && (
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
			</CardContent>
		</Card>
	);
}
