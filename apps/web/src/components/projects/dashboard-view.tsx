"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FolderGit2, Layers, Plus, Search, X } from "lucide-react";
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
import { countRunningServices } from "./service-summary";

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
			project.environments.some((env) => env.services.byStatus.error > 0),
		).length ?? 0;
	const filtered = projects?.filter(
		(project) =>
			[project.name, project.description, ...project.environments.map((env) => env.name)].some(
				(field) => field?.toLowerCase().includes(query),
			) &&
			(!needsAttention || project.environments.some((env) => env.services.byStatus.error > 0)),
	);
	const resetFilters = () => {
		setSearch("");
		setNeedsAttention(false);
	};
	return (
		<div className="space-y-8">
			<PageHeader
				title="Overview"
				description="Projects, environments and recent deployments."
				actions={
					<DisabledHint hint={createHint}>
						<CreateProjectDialog handleDeepLink={!capabilitiesLoading && canCreate}>
							<Button disabled={!canCreate}>
								<Plus aria-hidden="true" className="size-4" />
								New project
							</Button>
						</CreateProjectDialog>
					</DisabledHint>
				}
			/>
			<OverviewCards
				onAttention={() => {
					setSearch("");
					setNeedsAttention(true);
					document
						.getElementById("projects")
						?.scrollIntoView({ block: "start", behavior: "instant" });
				}}
			/>
			<section
				id="projects"
				className="min-w-0 scroll-mt-40 space-y-5"
				aria-labelledby="project-list-heading"
			>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<h2 id="project-list-heading" className="text-base font-medium tracking-tight">
							Projects
						</h2>
						{projects && (
							<span className="rounded border px-1.5 text-xs tabular-nums text-muted-foreground">
								{projects.length}
							</span>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-0 flex-1 sm:flex-none">
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								placeholder="Find a project…"
								aria-label="Search projects"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								className="h-9 w-full bg-card ps-9 pe-9 sm:w-60"
							/>
							{search && (
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
							)}
						</div>
						{(attentionCount > 0 || needsAttention) && (
							<Button
								type="button"
								size="sm"
								variant={needsAttention ? "secondary" : "ghost"}
								aria-pressed={needsAttention}
								onClick={() => setNeedsAttention((value) => !value)}
							>
								<StatusDot status="error" />
								Needs attention
								<span className="tabular-nums text-muted-foreground">{attentionCount}</span>
							</Button>
						)}
					</div>
				</div>
				<QueryState
					isPending={isPending}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!filtered?.length}
					skeleton={
						<div className="fieldwork-project-grid">
							{[1, 2].map((i) => (
								<div key={i} className="surface space-y-5 p-6">
									<Skeleton className="h-10 w-44" />
									<Skeleton className="h-4 w-4/5" />
									<div className="grid grid-cols-2 gap-3">
										<Skeleton className="h-24" />
										<Skeleton className="h-24" />
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
								description="Change your search or clear the filters."
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
								description="Organize your applications and databases into environments."
								action={
									<DisabledHint hint={createHint}>
										<CreateProjectDialog>
											<Button disabled={!canCreate}>
												<Plus aria-hidden="true" className="size-4" />
												New project
											</Button>
										</CreateProjectDialog>
									</DisabledHint>
								}
							/>
						)
					}
				>
					<div className="fieldwork-project-grid">
						{(filtered ?? []).map((project) => {
							const total = project.environments.reduce((n, env) => n + env.services.total, 0);
							return (
								<article className="fieldwork-project" key={project.projectId}>
									<header className="fieldwork-project-header">
										<span className="fieldwork-project-symbol">
											<FolderGit2 aria-hidden="true" className="size-4" strokeWidth={1.5} />
										</span>
										<div className="fieldwork-project-heading">
											<h3>
												<Link href={`/dashboard/projects/${project.projectId}`}>
													{project.name}
												</Link>
											</h3>
											<p>
												{total} {total === 1 ? "service" : "services"} in{" "}
												{project.environments.length}{" "}
												{project.environments.length === 1 ? "environment" : "environments"}
											</p>
										</div>
									</header>
									{project.description && (
										<p className="fieldwork-project-description">{project.description}</p>
									)}
									<div className="fieldwork-project-environments">
										{project.environments.slice(0, 4).map((environment) => (
											<Link
												className="fieldwork-project-environment"
												key={environment.environmentId}
												href={`/dashboard/projects/${project.projectId}?env=${encodeURIComponent(environment.name)}`}
											>
												<strong className="flex items-center gap-2">
													<Layers aria-hidden="true" className="size-3.5 text-muted-foreground" />
													{environment.name}
												</strong>
												<span>
													{environment.services.total}{" "}
													{environment.services.total === 1 ? "service" : "services"}
												</span>
												<span>
													<StatusDot
														status={
															environment.services.byStatus.error > 0
																? "error"
																: countRunningServices(environment.services.byStatus) > 0
																	? "success"
																	: "neutral"
														}
													/>
													{environment.services.byStatus.error > 0
														? `${environment.services.byStatus.error} need attention`
														: countRunningServices(environment.services.byStatus) > 0
															? `${countRunningServices(environment.services.byStatus)} running`
															: "No running services"}
												</span>
											</Link>
										))}
									</div>
									<footer className="fieldwork-project-footer">
										<span>
											Created <DateTime value={project.createdAt} />
										</span>
										{project.environments.length > 4 && (
											<Link href={`/dashboard/projects/${project.projectId}`}>
												{project.environments.length > 4
													? `All ${project.environments.length} environments`
													: "View project"}
												<ArrowUpRight aria-hidden="true" className="size-3.5" />
											</Link>
										)}
									</footer>
								</article>
							);
						})}
					</div>
				</QueryState>
			</section>
			<div id="deployments" className="fieldwork-evidence scroll-mt-40">
				<DeploymentsChart />
				<RecentDeployments />
			</div>
			<GettingStartedCard firstProjectId={projects?.[0]?.projectId} />
		</div>
	);
}
