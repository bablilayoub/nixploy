"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FolderGit2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
import { PageHeader, StatusDot } from "@/components/shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DateTime } from "@/components/ui/date-time";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
				title="Projects"
				description="Your applications and databases, organized by environment."
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
			<section
				id="projects"
				className="min-w-0 scroll-mt-40 space-y-5"
				aria-labelledby="project-list-heading"
			>
				<div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<h2 id="project-list-heading" className="text-base font-medium tracking-tight">
							All projects
						</h2>
						{projects && (
							<span className="rounded border px-1.5 text-xs tabular-nums text-muted-foreground">
								{projects.length}
							</span>
						)}
					</div>
					<div className="flex min-w-0 max-w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
						<div className="relative min-w-0 w-full sm:w-auto sm:flex-none">
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
								className="h-auto min-h-9 justify-start whitespace-normal py-2 text-left"
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
						<div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
							{[1, 2, 3].map((index) => (
								<Card key={index}>
									<CardHeader>
										<Skeleton className="size-8 rounded-md" />
										<Skeleton className="h-5 w-40" />
										<Skeleton className="h-4 w-2/3" />
									</CardHeader>
									<CardContent>
										<Skeleton className="h-9 w-full" />
									</CardContent>
									<CardFooter>
										<Skeleton className="h-4 w-28" />
									</CardFooter>
								</Card>
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
					<div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
						{(filtered ?? []).map((project) => {
							const total = project.environments.reduce((n, env) => n + env.services.total, 0);
							const running = project.environments.reduce(
								(n, env) => n + countRunningServices(env.services.byStatus),
								0,
							);
							const errors = project.environments.reduce(
								(n, env) => n + env.services.byStatus.error,
								0,
							);
							return (
								<Card key={project.projectId} className="min-w-0 gap-4">
									<CardHeader>
										<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
											<Avatar className="size-8 rounded-md">
												<AvatarFallback className="rounded-md">
													<FolderGit2 aria-hidden="true" className="size-4" />
												</AvatarFallback>
											</Avatar>
											<Badge variant="outline">
												<StatusDot status={errors ? "error" : running ? "success" : "neutral"} />
												{errors ? `${errors} need attention` : running ? "Running" : "Idle"}
											</Badge>
										</div>
										<CardTitle as="h3" className="mt-0">
											<Link
												href={`/dashboard/projects/${project.projectId}`}
												className="flex min-h-9 items-center justify-between gap-2 hover:underline underline-offset-4"
											>
												<span className="min-w-0 break-words">{project.name}</span>
												<ArrowUpRight
													aria-hidden="true"
													className="size-4 shrink-0 text-muted-foreground"
												/>
											</Link>
										</CardTitle>
										<CardDescription className="line-clamp-2">
											{project.description ||
												`${total} services across ${project.environments.length} environments`}
										</CardDescription>
									</CardHeader>
									<CardContent className="flex min-w-0 flex-wrap gap-2">
										{project.environments.slice(0, 4).map((environment) => (
											<Button key={environment.environmentId} variant="outline" size="sm" asChild>
												<Link
													href={`/dashboard/projects/${project.projectId}?env=${encodeURIComponent(environment.name)}`}
												>
													{environment.name}
												</Link>
											</Button>
										))}
										{project.environments.length > 4 && (
											<Button variant="ghost" size="sm" asChild>
												<Link href={`/dashboard/projects/${project.projectId}`}>
													+{project.environments.length - 4} more
												</Link>
											</Button>
										)}
										{project.environments.length === 0 && (
											<p className="text-sm text-muted-foreground">No environments yet</p>
										)}
									</CardContent>
									<CardFooter className="mt-auto flex-wrap justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
										<span className="tabular-nums">
											{running} / {total} services running
										</span>
										<DateTime value={project.createdAt} />
									</CardFooter>
								</Card>
							);
						})}
					</div>
				</QueryState>
			</section>
			<OverviewCards
				onAttention={() => {
					setSearch("");
					setNeedsAttention(true);
					document
						.getElementById("projects")
						?.scrollIntoView({ block: "start", behavior: "instant" });
				}}
			/>
			<Tabs id="deployments" defaultValue="recent" className="scroll-mt-24 gap-5 border-t pt-6">
				<SubTabsList aria-label="Workspace activity">
					<SubTabsTrigger value="recent">Recent deployments</SubTabsTrigger>
					<SubTabsTrigger value="trends">Deployment trends</SubTabsTrigger>
				</SubTabsList>
				<TabsContent value="recent">
					<RecentDeployments />
				</TabsContent>
				<TabsContent value="trends">
					<DeploymentsChart />
				</TabsContent>
			</Tabs>
			<GettingStartedCard firstProjectId={projects?.[0]?.projectId} />
		</div>
	);
}
