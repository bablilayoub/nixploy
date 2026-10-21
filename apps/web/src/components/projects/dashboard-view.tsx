"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderGit2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { PageHeader, StatusDot } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";

import { CreateProjectDialog } from "./create-project-dialog";
import { DashboardRecovery } from "./dashboard-recovery";
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
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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
		<div className="workspace-container space-y-6">
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
			<GettingStartedCard firstProjectId={projects?.[0]?.projectId} />
			<OverviewCards />
			<div className="workspace-columns grid min-w-0 gap-8">
				<section className="min-w-0 space-y-4" aria-labelledby="project-list-heading">
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2">
							<h2 id="project-list-heading" className="text-base font-semibold">
								All projects
							</h2>
							{projects ? (
								<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
									{projects.length}
								</span>
							) : null}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<div className="relative min-w-0 flex-1">
								<Search
									aria-hidden
									className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									placeholder="Search projects…"
									aria-label="Search projects"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									className="h-9 w-full ps-9 pe-9"
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
						<div className="space-y-3">
							{(filtered ?? []).map((project) => {
								const isExpanded = expanded.has(project.projectId);
								const detailsId = `project-environments-${project.projectId}`;
								return (
									<article
										key={project.projectId}
										className="overflow-hidden rounded-lg border bg-card"
									>
										<div className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-5 sm:gap-4 sm:px-5">
											<span className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:flex">
												<FolderGit2 aria-hidden className="size-5" />
											</span>
											<div className="flex min-w-0 max-w-full flex-1 basis-40 flex-col gap-3 min-[951px]:flex-row min-[951px]:items-center min-[951px]:gap-5">
												<div className="min-w-0 flex-1 space-y-1">
													<h3 className="text-sm font-semibold sm:text-[0.9375rem]">
														<Link
															href={`/dashboard/projects/${project.projectId}`}
															className="rounded-sm wrap-anywhere hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
														>
															{project.name}
														</Link>
													</h3>
													<p className="text-xs leading-relaxed text-muted-foreground wrap-anywhere">
														{project.description ||
															`${project.environments.length} ${project.environments.length === 1 ? "environment" : "environments"}`}
													</p>
												</div>
												<ProjectHealth environments={project.environments} />
											</div>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												aria-label={`${isExpanded ? "Collapse" : "Expand"} ${project.name}`}
												aria-expanded={isExpanded}
												aria-controls={detailsId}
												onClick={() =>
													setExpanded((current) => {
														const next = new Set(current);
														if (next.has(project.projectId)) next.delete(project.projectId);
														else next.add(project.projectId);
														return next;
													})
												}
											>
												<ChevronDown
													aria-hidden
													className={`size-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
												/>
											</Button>
										</div>
										<div id={detailsId} hidden={!isExpanded} className="border-t">
											{project.environments.length ? (
												<ul className="divide-y">
													{project.environments.map((environment) => (
														<li key={environment.environmentId}>
															<Link
																href={`/dashboard/projects/${project.projectId}?env=${encodeURIComponent(environment.name)}`}
																className="flex min-w-0 items-center gap-3 px-4 py-4 hover:bg-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
															>
																<div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
																	<span className="text-sm font-medium wrap-anywhere">
																		{environment.name}
																	</span>
																	<ProjectHealth environments={[environment]} />
																</div>
																<ChevronRight
																	aria-hidden
																	className="size-4 shrink-0 text-muted-foreground"
																/>
															</Link>
														</li>
													))}
												</ul>
											) : (
												<p className="px-5 py-4 text-sm text-muted-foreground">
													No environments yet. Open this project to add one.
												</p>
											)}
										</div>
									</article>
								);
							})}
						</div>
					</QueryState>
					<div className="pt-4">
						<DeploymentsChart />
					</div>
				</section>
				<aside aria-label="Workspace activity" className="min-w-0 space-y-7">
					<RecentDeployments />
					{projects?.length ? <DashboardRecovery projects={projects} /> : null}
				</aside>
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
