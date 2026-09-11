"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, FolderGit2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";

import { CreateProjectDialog } from "./create-project-dialog";
import { DeploymentsChart } from "./deployments-chart";
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
									New Project
								</Button>
							</CreateProjectDialog>
						</DisabledHint>
					</>
				}
			/>

			{/* Phones: project list first, then the compact 2×2 stats and the charts. */}
			<div className="flex flex-col gap-4">
				<div className="order-2 sm:order-none">
					<OverviewCards />
				</div>

				<div className="order-3 grid grid-cols-1 gap-4 sm:order-none lg:grid-cols-7">
					<div className="col-span-1 lg:col-span-4">
						<DeploymentsChart />
					</div>
					<div className="col-span-1 lg:col-span-3">
						<RecentDeployments />
					</div>
				</div>

				<div className="order-1 sm:order-none">
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
													New Project
												</Button>
											</CreateProjectDialog>
										</DisabledHint>
									}
								/>
							)
						}
					>
						<div className="divide-y rounded-lg border border-border">
							{(filtered ?? []).map((project) => {
								const serviceCount = project.environments.reduce(
									(total, environment) => total + environment.services.total,
									0,
								);
								return (
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
										<span className="hidden shrink-0 text-sm text-muted-foreground sm:block">
											{serviceCount} {serviceCount === 1 ? "service" : "services"}
										</span>
										<span className="hidden w-28 shrink-0 text-right text-sm text-muted-foreground md:block">
											{formatDistanceToNow(new Date(project.createdAt), {
												addSuffix: true,
											})}
										</span>
										<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
									</Link>
								);
							})}
						</div>
					</QueryState>
				</div>
			</div>
		</div>
	);
}
