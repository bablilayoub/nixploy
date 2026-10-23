"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderGit2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { PageHeader, StatusDot } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";

import { CreateProjectDialog } from "./create-project-dialog";
import { DeploymentsChart } from "./deployments-chart";
import { GettingStartedCard } from "./getting-started-card";
import { OverviewCards, RecentDeployments } from "./overview-section";

export function DashboardView() {
	const trpc = useTRPC();
	const { can, isLoading: capabilitiesLoading } = useCapabilities();
	const canCreate = can("project.write");
	const createHint = canCreate ? undefined : capabilityHint("project.write");
	const [search, setSearch] = useState("");
	const [needsAttention, setNeedsAttention] = useState(false);
	const {
		data: projects,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.project.all.queryOptions());

	const query = search.trim().toLowerCase();
	const attentionCount =
		projects?.filter((project) =>
			project.environments.some((environment) => environment.services.byStatus.error > 0),
		).length ?? 0;
	const filtered = projects?.filter((project) => {
		const matchesSearch = [
			project.name,
			project.description,
			...project.environments.map((environment) => environment.name),
		].some((field) => field?.toLowerCase().includes(query));
		return (
			matchesSearch &&
			(!needsAttention ||
				project.environments.some((environment) => environment.services.byStatus.error > 0))
		);
	});
	const resetFilters = () => {
		setSearch("");
		setNeedsAttention(false);
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title="Projects"
				description="Projects, environments, and services."
				actions={
					<DisabledHint hint={createHint}>
						<CreateProjectDialog handleDeepLink={!capabilitiesLoading && canCreate}>
							<Button disabled={!canCreate}>
								<Plus className="size-4" />
								New project
							</Button>
						</CreateProjectDialog>
					</DisabledHint>
				}
			/>
			{/* Keep the project directory ahead of analytics at every width. */}
			<div className="flex flex-col gap-6">
				<GettingStartedCard firstProjectId={projects?.[0]?.projectId} />
				<section className="space-y-4" aria-labelledby="project-list-heading">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-center gap-2">
							<h2 id="project-list-heading" className="text-sm font-semibold">
								All projects
							</h2>
							{projects ? (
								<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
									{projects.length}
								</span>
							) : null}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<div className="relative min-w-0 flex-1 sm:flex-none">
								<Search
									aria-hidden
									className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									placeholder="Search projects…"
									aria-label="Search projects"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									className="h-9 w-full ps-9 pe-9 sm:w-64"
								/>
								{search ? (
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label="Clear project search"
										className="absolute end-0.5 top-0.5"
										onClick={() => setSearch("")}
									>
										<X className="size-3.5" />
									</Button>
								) : null}
							</div>
							{attentionCount > 0 || needsAttention ? (
								<Button
									type="button"
									variant={needsAttention ? "secondary" : "outline"}
									aria-pressed={needsAttention}
									onClick={() => setNeedsAttention((current) => !current)}
									className="gap-2"
								>
									<StatusDot status="error" />
									Needs attention
									<span className="tabular-nums text-muted-foreground">{attentionCount}</span>
								</Button>
							) : null}
						</div>
					</div>
					<QueryState
						isPending={isPending}
						isError={isError}
						error={error}
						onRetry={() => refetch()}
						isEmpty={!filtered?.length}
						skeleton={
							<div className="divide-y rounded-lg border">
								{Array.from({ length: 4 }).map((_, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
									<div key={index} className="flex items-center gap-4 px-4 py-4">
										<Skeleton className="size-9 shrink-0" />
										<div className="space-y-2">
											<Skeleton className="h-4 w-40" />
											<Skeleton className="h-3 w-24" />
										</div>
									</div>
								))}
							</div>
						}
						empty={
							query || needsAttention ? (
								<EmptyState
									icon={Search}
									title="No projects match"
									description="Try a different search or clear the filters to see all projects."
									action={
										<Button variant="outline" onClick={resetFilters}>
											Clear filters
										</Button>
									}
								/>
							) : (
								<EmptyState
									icon={FolderGit2}
									title="Create your first project"
									description="Group environments and services, then deploy an app or database."
									action={
										<DisabledHint hint={createHint}>
											<CreateProjectDialog>
												<Button disabled={!canCreate}>
													<Plus className="size-4" />
													New project
												</Button>
											</CreateProjectDialog>
										</DisabledHint>
									}
								/>
							)
						}
					>
						<div className="divide-y overflow-hidden rounded-lg border border-border bg-card">
							{(filtered ?? []).map((project) => (
								<Link
									key={project.projectId}
									href={`/dashboard/projects/${project.projectId}`}
									className="group flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4"
								>
									<span className="hidden size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground sm:flex">
										<FolderGit2 className="size-4" />
									</span>
									<div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
										<div className="min-w-0 flex-1 space-y-1">
											<span className="block truncate text-sm font-medium">{project.name}</span>
											<span className="block truncate text-xs text-muted-foreground sm:text-sm">
												{project.description ||
													`${project.environments.length} ${project.environments.length === 1 ? "environment" : "environments"}`}
											</span>
										</div>
										<ProjectHealth environments={project.environments} />
									</div>
									<DateTime
										value={project.createdAt}
										className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground lg:block"
									/>
									<ChevronRight
										aria-hidden
										className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
									/>
								</Link>
							))}
						</div>
					</QueryState>
				</section>
				<OverviewCards />
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
					<div className="col-span-1 lg:col-span-4">
						<DeploymentsChart />
					</div>
					<div className="col-span-1 lg:col-span-3">
						<RecentDeployments />
					</div>
				</div>
			</div>
		</div>
	);
}

/** Service health stays readable on phones as well as in the desktop directory. */
function ProjectHealth({
	environments,
}: {
	environments: Array<{
		services: { total: number; byStatus: { running: number; error: number } };
	}>;
}) {
	const counts = environments.reduce(
		(total, environment) => ({
			running: total.running + environment.services.byStatus.running,
			error: total.error + environment.services.byStatus.error,
			total: total.total + environment.services.total,
		}),
		{ running: 0, error: 0, total: 0 },
	);
	if (counts.total === 0)
		return <span className="shrink-0 text-xs text-muted-foreground">No services</span>;
	return (
		<span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
			{counts.error > 0 ? (
				<span className="flex items-center gap-1.5 text-destructive">
					<StatusDot status="error" />
					{counts.error} failing
				</span>
			) : null}
			{counts.running > 0 ? (
				<span className="flex items-center gap-1.5">
					<StatusDot status="success" />
					{counts.running} running
				</span>
			) : null}
			<span>
				{counts.total} {counts.total === 1 ? "service" : "services"}
			</span>
		</span>
	);
}
