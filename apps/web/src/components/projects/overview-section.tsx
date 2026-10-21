"use client";

import { useQuery } from "@tanstack/react-query";
import { Container, FolderGit2, Rocket, Server } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { StatusDot } from "@/components/shell";
import { DateTime } from "@/components/ui/date-time";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useRunningDeployments } from "@/hooks/use-running-deployments";
import { deploymentStatusDot, deploymentStatusLabel } from "@/lib/status";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function StatPanel({
	label,
	value,
	detail,
	isPending,
	icon,
	className,
}: {
	label: string;
	value: number | undefined;
	detail?: ReactNode;
	isPending: boolean;
	icon: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("surface px-5 py-4", className)}>
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs leading-relaxed font-medium text-muted-foreground">{label}</p>
				{icon}
			</div>
			<div className="mt-2 text-[2rem] leading-tight font-semibold tabular-nums tracking-[-0.045em]">
				{isPending ? <Skeleton className="h-7 w-14 sm:h-8 sm:w-16" /> : (value ?? 0)}
			</div>
			{!isPending && detail ? (
				<p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
			) : null}
		</div>
	);
}

/** Organization-wide stats: projects, services by status, deployments of the last day. */
export function OverviewCards() {
	const trpc = useTRPC();
	const { can, isInstanceAdmin } = useCapabilities({ strict: true });
	const showDocker = isInstanceAdmin && can("docker.manage");
	const { data, isPending, isError, error, refetch } = useQuery(
		trpc.project.overview.queryOptions(),
	);

	if (isError) {
		return (
			<QueryState
				isPending={false}
				isError={isError}
				error={error}
				onRetry={() => refetch()}
				isEmpty={false}
				empty={null}
			>
				{null}
			</QueryState>
		);
	}

	const services = data?.services;
	const deployments = data?.deploymentsLastDay;

	return (
		<div
			className={cn(
				"grid grid-cols-1 gap-3 min-[480px]:grid-cols-2",
				showDocker ? "lg:grid-cols-4" : "lg:grid-cols-3",
			)}
		>
			<StatPanel
				label="Projects"
				value={data?.projectCount}
				isPending={isPending}
				icon={<FolderGit2 className="size-4 text-muted-foreground" />}
			/>
			<StatPanel
				label="Services"
				className=""
				value={services?.total}
				isPending={isPending}
				icon={<Server className="size-4 text-muted-foreground" />}
				detail={
					services && (
						<>
							{services.running} running
							{services.error > 0 ? (
								<>
									{" · "}
									<Link
										href="/dashboard/monitoring"
										className="rounded-sm text-destructive underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{services.error} error
									</Link>
								</>
							) : null}
						</>
					)
				}
			/>
			<StatPanel
				label="Deployments (24h)"
				className={!showDocker ? "min-[480px]:col-span-2 lg:col-span-1" : undefined}
				value={deployments?.total}
				isPending={isPending}
				icon={<Rocket className="size-4 text-muted-foreground" />}
				detail={
					deployments && (
						<>
							{deployments.done} succeeded
							{deployments.error > 0 ? (
								<>
									{" · "}
									<Link
										href="/dashboard/monitoring?tab=incidents"
										className="rounded-sm text-destructive underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{deployments.error} failed
									</Link>
								</>
							) : null}
						</>
					)
				}
			/>
			{showDocker ? <DockerStatPanel /> : null}
		</div>
	);
}

function DockerStatPanel() {
	const trpc = useTRPC();
	const containersQuery = useQuery(trpc.docker.containers.queryOptions({}));
	const containers = containersQuery.data ?? [];
	const running = containers.filter((container) => container.State === "running").length;

	return (
		<Link
			href="/dashboard/docker"
			className="block surface p-5 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs leading-relaxed font-medium text-muted-foreground">Docker</p>
				<Container className="size-4 text-muted-foreground" />
			</div>
			<div className="mt-2 text-[2rem] leading-tight font-semibold tabular-nums tracking-[-0.045em]">
				{containersQuery.isPending ? (
					<Skeleton className="h-7 w-14 sm:h-8 sm:w-16" />
				) : containersQuery.isError ? (
					<span className="text-sm font-normal text-muted-foreground">Unavailable</span>
				) : (
					running
				)}
			</div>
			{!containersQuery.isPending && !containersQuery.isError ? (
				<p className="mt-2 text-xs text-muted-foreground">
					{running} / {containers.length} containers running
				</p>
			) : null}
		</Link>
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
		<section className="flex h-full min-w-0 flex-col surface p-5 sm:p-5">
			<div className="mb-5 space-y-1">
				<h2 className="text-base font-semibold tracking-tight">Recent deployments</h2>
				{/* Static text: branching this on `isPending` made the server (which
				    renders with the prefetched data) and the client's first paint
				    disagree, which cost a hydration error on every dashboard load.
				    Loading and empty already have their own states below. */}
				<p className="text-sm text-muted-foreground">The latest changes, across your workspace.</p>
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
								<div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
									<p className="min-w-0 text-sm leading-5 font-medium wrap-anywhere">{name}</p>
									<span className="text-xs leading-5 font-medium">
										{deploymentStatusLabel[deployment.status] ?? deployment.status}
									</span>
									<p className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
										<span className="min-w-0 truncate">
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
