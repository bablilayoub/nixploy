"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { StatusPageCard } from "@/components/monitoring/status-page-card";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { PageHeader } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import { DisabledHint } from "@/components/ui/disabled-hint";
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
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

/**
 * Incident timeline. Rendered as the Monitoring page's "Incidents" tab (UX
 * audit F11); `embedded` drops the page title that tab already carries.
 */
/**
 * Deploy-failure incidents record the service kind in their metadata (older
 * rows do not), which is what makes a linkable service page out of the ids the
 * row already carries.
 */
function serviceHref(incident: {
	projectId?: string | null;
	serviceId?: string | null;
	metadata?: Record<string, unknown> | null;
}): string | null {
	const kind = incident.metadata?.serviceKind;
	if (!incident.projectId || !incident.serviceId || typeof kind !== "string") return null;
	return `/dashboard/projects/${incident.projectId}/services/${kind}/${incident.serviceId}?tab=deploy`;
}

export function IncidentsView({ embedded = false }: { embedded?: boolean } = {}) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const [projectId, setProjectId] = useState<string>("all");
	const projects = useQuery(trpc.project.all.queryOptions());
	const incidents = useQuery(
		trpc.observability.incidents.queryOptions({
			projectId: projectId === "all" ? undefined : projectId,
			limit: 100,
		}),
	);

	const incidentsKey = trpc.observability.incidents.queryKey();

	const acknowledge = useSaveMutation(trpc.observability.acknowledgeIncident.mutationOptions(), {
		invalidate: [incidentsKey],
	});
	const resolve = useSaveMutation(trpc.observability.resolveIncident.mutationOptions(), {
		invalidate: [incidentsKey],
	});

	const canManage = can("project.write");
	const manageHint = canManage ? undefined : capabilityHint("project.write");
	/** Which incident id each mutation is currently working on. */
	const busyAck = acknowledge.isPending ? acknowledge.variables?.incidentId : null;
	const busyResolve = resolve.isPending ? resolve.variables?.incidentId : null;

	return (
		<div className="flex flex-col gap-8">
			{embedded ? null : (
				<PageHeader
					title="Incidents"
					description="Failed deploys, alert-rule trips, watchdog events and uptime flips across your projects."
				/>
			)}
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
										<div className="flex min-w-0 flex-wrap items-center gap-2">
											<p className="font-medium">{incident.title}</p>
											{incident.resolvedAt ? (
												<Badge variant="secondary">Resolved</Badge>
											) : incident.acknowledgedAt ? (
												<Badge variant="outline">Acknowledged</Badge>
											) : null}
										</div>
										<DateTime
											value={incident.createdAt}
											className="text-xs text-muted-foreground"
										/>
									</div>
									<p className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground">
										<span>{incident.kind}</span>
										{incident.serviceName ? (
											<>
												<span aria-hidden>·</span>
												{/* An incident that names a service should take you to it —
												    that is the next thing anyone reading this wants. */}
												{serviceHref(incident) ? (
													<Link
														href={serviceHref(incident) ?? "#"}
														className="underline underline-offset-2 hover:text-foreground"
													>
														{incident.serviceName}
													</Link>
												) : (
													<span>{incident.serviceName}</span>
												)}
											</>
										) : null}
										{incident.severity ? (
											<>
												<span aria-hidden>·</span>
												<span>{incident.severity}</span>
											</>
										) : null}
									</p>
									{incident.message && (
										<p className="mt-2 whitespace-pre-wrap text-muted-foreground">
											{incident.message}
										</p>
									)}
									{incident.resolvedAt ? (
										<p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
											<Check className="size-3.5" />
											Resolved <DateTime value={incident.resolvedAt} />
										</p>
									) : (
										<div className="mt-3 flex flex-wrap gap-2">
											{incident.acknowledgedAt ? null : (
												<DisabledHint hint={manageHint}>
													<Button
														size="sm"
														variant="outline"
														disabled={!canManage || busyAck === incident.incidentId}
														onClick={() => acknowledge.mutate({ incidentId: incident.incidentId })}
													>
														{busyAck === incident.incidentId && (
															<Loader2 className="size-3.5 animate-spin" />
														)}
														Acknowledge
													</Button>
												</DisabledHint>
											)}
											<DisabledHint hint={manageHint}>
												<Button
													size="sm"
													disabled={!canManage || busyResolve === incident.incidentId}
													onClick={() => resolve.mutate({ incidentId: incident.incidentId })}
												>
													{busyResolve === incident.incidentId && (
														<Loader2 className="size-3.5 animate-spin" />
													)}
													Resolve
												</Button>
											</DisabledHint>
										</div>
									)}
								</div>
							))}
						</div>
					</QueryState>
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
