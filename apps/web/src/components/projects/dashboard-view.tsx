"use client";
import { useQuery } from "@tanstack/react-query";
import { FolderGit2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
import { PageHeader, StatusDot } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/ui/date-time";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@/components/ui/item";
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
		<div className="flex min-w-0 flex-col gap-6">
			<PageHeader
				title="Overview"
				description="Your projects, services and latest deployments."
				actions={
					<DisabledHint hint={createHint}>
						<CreateProjectDialog handleDeepLink={!capabilitiesLoading && canCreate}>
							<Button disabled={!canCreate}>
								<Plus aria-hidden="true" />
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
			<div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
				<section
					id="projects"
					aria-labelledby="project-list-heading"
					className="min-w-0 scroll-mt-24"
				>
					<Card>
						<CardHeader>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<CardTitle as="h2" id="project-list-heading">
									Projects
								</CardTitle>
								{projects && <Badge variant="secondary">{projects.length}</Badge>}
							</div>
							<CardDescription>Open a project to manage its services.</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex min-w-0 flex-wrap gap-2">
								<div className="relative min-w-0 flex-1">
									<Search
										aria-hidden="true"
										className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
									/>
									<Input
										aria-label="Search projects"
										placeholder="Search projects…"
										value={search}
										onChange={(e) => setSearch(e.target.value)}
										className="ps-9 pe-9"
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
											<X />
										</Button>
									)}
								</div>
								{(attentionCount > 0 || needsAttention) && (
									<Button
										type="button"
										variant={needsAttention ? "secondary" : "outline"}
										aria-pressed={needsAttention}
										onClick={() => setNeedsAttention((v) => !v)}
									>
										<StatusDot status="error" />
										Needs attention <span className="tabular-nums">{attentionCount}</span>
									</Button>
								)}
							</div>
							<QueryState
								isPending={isPending}
								isError={isError}
								error={error}
								onRetry={() => refetch()}
								isEmpty={!filtered?.length}
								skeleton={
									<div className="space-y-3">
										{[1, 2, 3].map((i) => (
											<Item variant="outline" key={i}>
												<ItemMedia variant="icon" className="hidden sm:flex">
													<FolderGit2 />
												</ItemMedia>
												<ItemContent className="min-w-0">
													<Skeleton className="h-4 w-40" />
													<Skeleton className="h-4 w-2/3" />
												</ItemContent>
											</Item>
										))}
									</div>
								}
								empty={
									query || needsAttention ? (
										<EmptyState
											icon={Search}
											title="No projects match"
											description="Try another search or clear the filters."
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
															<Plus />
															New project
														</Button>
													</CreateProjectDialog>
												</DisabledHint>
											}
										/>
									)
								}
							>
								<ItemGroup className="divide-y">
									{(filtered ?? []).map((project) => {
										const total = project.environments.reduce(
											(n, env) => n + env.services.total,
											0,
										);
										const running = project.environments.reduce(
											(n, env) => n + countRunningServices(env.services.byStatus),
											0,
										);
										const errors = project.environments.reduce(
											(n, env) => n + env.services.byStatus.error,
											0,
										);
										return (
											<Item
												key={project.projectId}
												role="listitem"
												size="sm"
												className="items-start px-0"
											>
												<ItemMedia variant="icon" className="hidden sm:flex">
													<FolderGit2 aria-hidden="true" />
												</ItemMedia>
												<ItemContent className="min-w-0">
													<ItemTitle className="min-w-0 max-w-full flex-wrap">
														<Link
															href={`/dashboard/projects/${project.projectId}`}
															className="break-words underline-offset-4 hover:underline"
														>
															{project.name}
														</Link>
														<Badge variant="outline">
															<StatusDot
																status={errors ? "error" : running ? "success" : "neutral"}
															/>
															{errors ? `${errors} need attention` : running ? "Running" : "Idle"}
														</Badge>
													</ItemTitle>
													<ItemDescription>
														{project.description ||
															`${total} services across ${project.environments.length} environments`}
													</ItemDescription>
													<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
														<span className="tabular-nums">
															{running} / {total} services running
														</span>
														<DateTime value={project.createdAt} />
													</div>
													<div className="mt-2 flex min-w-0 flex-wrap gap-2">
														{project.environments.slice(0, 4).map((env) => (
															<Button key={env.environmentId} asChild variant="outline" size="sm">
																<Link
																	href={`/dashboard/projects/${project.projectId}?env=${encodeURIComponent(env.name)}`}
																>
																	{env.name}
																</Link>
															</Button>
														))}
														{project.environments.length > 4 && (
															<Button asChild variant="ghost" size="sm">
																<Link href={`/dashboard/projects/${project.projectId}`}>
																	+{project.environments.length - 4} more
																</Link>
															</Button>
														)}
														{project.environments.length === 0 && (
															<span className="text-xs text-muted-foreground">
																No environments yet
															</span>
														)}
													</div>
												</ItemContent>
											</Item>
										);
									})}
								</ItemGroup>
							</QueryState>
						</CardContent>
					</Card>
				</section>
				<aside className="min-w-0 space-y-6" aria-label="Deployment activity">
					<Card>
						<CardHeader>
							<CardTitle as="h2">Activity</CardTitle>
							<CardDescription>Releases across your workspace.</CardDescription>
						</CardHeader>
						<CardContent>
							<Tabs id="deployments" defaultValue="recent" className="gap-4">
								<SubTabsList aria-label="Workspace activity">
									<SubTabsTrigger value="recent">Recent deployments</SubTabsTrigger>
									<SubTabsTrigger value="trends">Trends</SubTabsTrigger>
								</SubTabsList>
								<TabsContent value="recent">
									<RecentDeployments />
								</TabsContent>
								<TabsContent value="trends">
									<DeploymentsChart framed={false} />
								</TabsContent>
							</Tabs>
						</CardContent>
					</Card>
					<GettingStartedCard firstProjectId={projects?.[0]?.projectId} />
				</aside>
			</div>
		</div>
	);
}
