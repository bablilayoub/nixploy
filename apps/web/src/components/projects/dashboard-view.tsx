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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
				<div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
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
						<div className="rounded-xl border border-border bg-background">
							<Table>
								<TableBody>
									{[1, 2, 3].map((index) => (
										<TableRow key={index}>
											<TableCell className="py-6">
												<Skeleton className="h-5 w-40" />
												<Skeleton className="mt-3 h-4 w-2/3" />
											</TableCell>
											<TableCell className="hidden lg:table-cell">
												<Skeleton className="h-9 w-36" />
											</TableCell>
											<TableCell className="hidden lg:table-cell">
												<Skeleton className="h-5 w-20" />
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
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
					<div className="rounded-xl border border-border bg-background">
						<Table>
							<caption className="sr-only">
								Projects and their environments, service counts and health
							</caption>
							<TableHeader>
								<TableRow>
									<TableHead>Project</TableHead>
									<TableHead className="hidden lg:table-cell">Environments</TableHead>
									<TableHead className="hidden lg:table-cell">Services</TableHead>
									<TableHead className="hidden lg:table-cell">Health</TableHead>
									<TableHead className="hidden xl:table-cell">Created</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
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
										<TableRow key={project.projectId}>
											<TableCell className="min-w-44 max-w-72 py-5">
												<Link
													href={`/dashboard/projects/${project.projectId}`}
													className="flex min-h-11 items-center gap-3 font-medium underline-offset-4 hover:underline"
												>
													<FolderGit2
														aria-hidden="true"
														className="size-4 shrink-0 text-muted-foreground"
													/>
													<span className="break-words">{project.name}</span>
													<ArrowUpRight
														aria-hidden="true"
														className="size-3.5 shrink-0 text-muted-foreground"
													/>
												</Link>
												{project.description && (
													<p className="mt-1 max-w-64 text-sm text-muted-foreground break-words">
														{project.description}
													</p>
												)}
												<div className="mt-3 flex flex-col gap-2 lg:hidden">
													<p className="text-xs text-muted-foreground">
														{total} services · {running} running
														{errors > 0 && (
															<span className="font-medium text-foreground">
																{" "}
																· {errors} need attention
															</span>
														)}
													</p>
													<div className="flex flex-wrap gap-2">
														{project.environments.slice(0, 4).map((environment) => (
															<Badge key={environment.environmentId} variant="outline" asChild>
																<Link
																	className="min-h-11"
																	href={`/dashboard/projects/${project.projectId}?env=${encodeURIComponent(environment.name)}`}
																>
																	{environment.name}
																</Link>
															</Badge>
														))}
														{project.environments.length > 4 && (
															<Link
																href={`/dashboard/projects/${project.projectId}`}
																className="inline-flex min-h-11 items-center text-xs underline"
															>
																All environments
															</Link>
														)}
													</div>
												</div>
											</TableCell>
											<TableCell className="hidden min-w-44 py-5 lg:table-cell">
												<div className="flex max-w-64 flex-wrap gap-2">
													{project.environments.slice(0, 4).map((environment) => (
														<Badge key={environment.environmentId} variant="outline" asChild>
															<Link
																className="min-h-11"
																href={`/dashboard/projects/${project.projectId}?env=${encodeURIComponent(environment.name)}`}
															>
																{environment.name}
															</Link>
														</Badge>
													))}
													{project.environments.length > 4 && (
														<Link
															href={`/dashboard/projects/${project.projectId}`}
															className="inline-flex min-h-11 items-center text-xs underline"
														>
															+{project.environments.length - 4} more
														</Link>
													)}
												</div>
											</TableCell>
											<TableCell className="hidden py-5 lg:table-cell">
												<span className="text-base font-medium">{total}</span>
												<p className="mt-1 text-xs text-muted-foreground">{running} running</p>
											</TableCell>
											<TableCell className="hidden min-w-36 py-5 lg:table-cell">
												<Badge variant="secondary">
													<StatusDot status={errors ? "error" : running ? "success" : "neutral"} />
													{errors ? `${errors} need attention` : running ? "Running" : "Idle"}
												</Badge>
											</TableCell>
											<TableCell className="hidden xl:table-cell">
												<DateTime value={project.createdAt} />
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				</QueryState>
			</section>
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
