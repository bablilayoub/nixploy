"use client";

import { useQuery } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import Link from "next/link";

import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { StatusDot } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { DateTime } from "@/components/ui/date-time";
import { Skeleton } from "@/components/ui/skeleton";
import { useRunningDeployments } from "@/hooks/use-running-deployments";
import { deploymentStatusDot, deploymentStatusLabel } from "@/lib/status";
import { useTRPC } from "@/lib/trpc";
import { countRunningServices } from "./service-summary";

/** A single truthful status strip, not a row of decorative KPI cards. */
export function OverviewCards({ onAttention }: { onAttention: () => void }) {
	const trpc = useTRPC();
	const { data, isPending, isError, error, refetch } = useQuery(
		trpc.project.overview.queryOptions(),
	);
	if (isError)
		return (
			<QueryState
				isPending={false}
				isError
				error={error}
				onRetry={() => refetch()}
				isEmpty={false}
				empty={null}
			>
				{null}
			</QueryState>
		);
	const services = data?.services;
	const metrics = [
		{
			label: "Running services",
			value: countRunningServices(services),
			detail: `${services?.total ?? 0} services across your workspace`,
		},
		{
			label: "Projects",
			value: data?.projectCount ?? 0,
			detail: "Grouped into isolated environments",
		},
		{
			label: "Deployments",
			value: data?.deploymentsLastDay.total ?? 0,
			detail: "Releases in the last 24 hours",
		},
		{ label: "Need attention", value: services?.error ?? 0, detail: "Services reporting an error" },
	];
	return (
		<section
			aria-label="Workspace summary"
			aria-busy={isPending}
			className="grid grid-cols-2 gap-3 xl:grid-cols-4"
		>
			{metrics.map((metric) => (
				<Card key={metric.label} className="gap-2 py-4">
					<CardHeader>
						<CardDescription>{metric.label}</CardDescription>
					</CardHeader>
					<CardContent>
						{isPending ? (
							<Skeleton className="h-9 w-16" />
						) : (
							<p className="text-3xl font-medium tracking-tight tabular-nums">{metric.value}</p>
						)}
					</CardContent>
					<CardFooter className="hidden min-h-11 text-xs text-muted-foreground sm:flex">
						{isPending ? (
							<Skeleton className="h-3 w-32" />
						) : metric.label === "Need attention" && (services?.error ?? 0) > 0 ? (
							<Button variant="link" size="sm" onClick={onAttention}>
								Review services
							</Button>
						) : (
							metric.detail
						)}
					</CardFooter>
				</Card>
			))}
		</section>
	);
}

/** Latest deployments across every project of the organization. */
export function RecentDeployments() {
	// Shares the one running-deployments query (UX audit F31): it polls only
	// while something is queued or running instead of every 10 s forever, and
	// every deploy mutation invalidates it, so the list still updates live.
	const { deployments: all, isPending, isError, error, refetch } = useRunningDeployments();
	const deployments = all.slice(0, 4);

	return (
		<section className="flex h-full min-w-0 flex-col surface p-6">
			<div className="mb-5 space-y-1">
				<h2 className="text-base font-medium tracking-tight">Recent deployments</h2>
				{/* Static text: branching this on `isPending` made the server (which
				    renders with the prefetched data) and the client's first paint
				    disagree, which cost a hydration error on every dashboard load.
				    Loading and empty already have their own states below. */}
				<p className="text-sm text-muted-foreground">Latest releases across all projects.</p>
			</div>
			<QueryState
				isPending={isPending}
				isError={isError}
				error={error}
				onRetry={() => refetch()}
				isEmpty={deployments.length === 0}
				skeleton={
					<div className="space-y-4">
						{Array.from({ length: 4 }).map((_, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
							<div key={index} className="flex items-center gap-3">
								<Skeleton className="size-8 rounded-full" />
								<div className="flex-1 space-y-1">
									<Skeleton className="h-4 w-40" />
									<Skeleton className="h-3 w-28" />
								</div>
							</div>
						))}
					</div>
				}
				empty={
					<EmptyState
						icon={Rocket}
						title="No deployments yet"
						description="Deploy a service and it will show up here."
					/>
				}
			>
				<div className="divide-y">
					{deployments.map((deployment) => {
						const serviceType = deployment.service.type;
						const serviceId =
							serviceType === "application" ? deployment.applicationId : deployment.composeId;
						const href = serviceId
							? `/dashboard/projects/${deployment.project.projectId}/services/${serviceType}/${serviceId}`
							: null;
						const name = deployment.service.name ?? deployment.service.appName ?? "Service";
						const inner = (
							<>
								<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
									<StatusDot status={deploymentStatusDot[deployment.status] ?? "neutral"} />
								</span>
								<div className="grid min-w-0 flex-1 grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
									<p className="min-w-0 text-sm leading-5 font-medium wrap-anywhere">{name}</p>
									<span className="text-xs leading-5 font-medium">
										{deploymentStatusLabel[deployment.status] ?? deployment.status}
									</span>
									<p className="flex min-w-0 flex-wrap sm:col-span-2 items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
										<span className="min-w-0 break-words">
											{deployment.project.name} · <span className="capitalize">{serviceType}</span>
										</span>
										<DateTime value={deployment.createdAt} className="shrink-0" />
									</p>
								</div>
							</>
						);
						return href ? (
							<Link
								key={deployment.deploymentId}
								href={href}
								className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{inner}
							</Link>
						) : (
							<div key={deployment.deploymentId} className="flex items-center gap-3 px-1 py-2">
								{inner}
							</div>
						);
					})}
				</div>
			</QueryState>
		</section>
	);
}
