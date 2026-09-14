"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderGit2, Plus, Search } from "lucide-react";
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
	const { can } = useCapabilities();
	const canCreate = can("project.write");
	const createHint = canCreate ? undefined : capabilityHint("project.write");
	const [search, setSearch] = useState("");
	const {
		data: projects,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.project.all.queryOptions());

	const query = search.trim().toLowerCase();
	const filtered = projects?.filter((project) => project.name.toLowerCase().includes(query));

	return (
		<div className="space-y-4">
			<PageHeader
				title="Projects"
				description="Projects, environments, and services."
				actions={
					<>
						<div className="relative">
							<Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search projects..."
								aria-label="Search projects"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								className="h-8 w-full pl-8 sm:w-56"
							/>
						</div>
						<DisabledHint hint={createHint}>
							<CreateProjectDialog>
								<Button size="sm" disabled={!canCreate}>
									<Plus className="size-4" />
									New project
								</Button>
							</CreateProjectDialog>
						</DisabledHint>
					</>
				}
			/>

			{/* Phones: project list first, then the compact 2×2 stats and the charts. */}
			<div className="flex flex-col gap-4">
				<div className="order-1 sm:order-none">
					<GettingStartedCard firstProjectId={projects?.[0]?.projectId} />
				</div>

				<div className="order-3 sm:order-none">
					<OverviewCards />
				</div>

				<div className="order-4 grid grid-cols-1 gap-4 sm:order-none lg:grid-cols-7">
					<div className="col-span-1 lg:col-span-4">
						<DeploymentsChart />
					</div>
					<div className="col-span-1 lg:col-span-3">
						<RecentDeployments />
					</div>
				</div>

				<div className="order-2 sm:order-none">
					<QueryState
						isPending={isPending}
						isError={isError}
						error={error}
						onRetry={() => refetch()}
						isEmpty={!filtered || filtered.length === 0}
						skeleton={
							<div className="divide-y rounded-lg border border-border">
								{Array.from({ length: 4 }).map((_, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
									<div key={index} className="flex items-center gap-4 px-4 py-3.5">
										<Skeleton className="h-5 w-40" />
										<Skeleton className="h-4 w-24" />
									</div>
								))}
							</div>
						}
						empty={
							query ? (
								<EmptyState
									icon={Search}
									title="No projects match"
									description="Try a different search term."
								/>
							) : (
								<EmptyState
									icon={FolderGit2}
									title="Create your first project"
									description="Group environments and services, then deploy an app or database."
									action={
										<DisabledHint hint={createHint}>
											<CreateProjectDialog>
												<Button size="sm" disabled={!canCreate}>
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
						<div className="divide-y rounded-lg border border-border">
							{(filtered ?? []).map((project) => (
								<Link
									key={project.projectId}
									href={`/dashboard/projects/${project.projectId}`}
									className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/50"
								>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="truncate text-sm font-medium">{project.name}</span>
										<span className="truncate text-sm text-muted-foreground">
											{project.description || "No description"}
										</span>
									</div>
									<ProjectHealth environments={project.environments} />
									<DateTime
										value={project.createdAt}
										className="hidden w-28 shrink-0 text-right text-sm text-muted-foreground md:block"
									/>
									<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
								</Link>
							))}
						</div>
					</QueryState>
				</div>
			</div>
		</div>
	);
}

/**
 * Health of a project at a glance: how many of its services are failing or
 * running, and the total. Scanning the list for a red dot is the reason the
 * dashboard exists, so the counts come before the service total.
 */
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
	if (counts.total === 0) {
		return (
			<span className="hidden shrink-0 text-sm text-muted-foreground sm:block">No services</span>
		);
	}
	return (
		<span className="hidden shrink-0 items-center gap-3 text-sm text-muted-foreground sm:flex">
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
