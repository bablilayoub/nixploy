"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Container, FolderGit2, Rocket, Server } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { StatusDot } from "@/components/shell";
import { DateTime } from "@/components/ui/date-time";
import { Skeleton } from "@/components/ui/skeleton";
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
		<div className={cn("rounded-lg border border-border p-3 sm:p-4", className)}>
			<div className="flex items-center justify-between gap-2">
				<p className="truncate text-xs font-medium text-foreground sm:text-sm">{label}</p>
				{icon}
			</div>
			<div className="mt-1 text-xl font-semibold tabular-nums tracking-tight sm:mt-2 sm:text-2xl">
				{isPending ? <Skeleton className="h-7 w-14 sm:h-8 sm:w-16" /> : (value ?? 0)}
			</div>
			{!isPending && detail ? (
				<p className="mt-1 hidden text-xs text-muted-foreground sm:block">{detail}</p>
			) : null}
		</div>
	);
}

/** Organization-wide stats: projects, services by status, deployments of the last day. */
export function OverviewCards() {
	const trpc = useTRPC();
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
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<StatPanel
				label="Projects"
				value={data?.projectCount}
				isPending={isPending}
				icon={<FolderGit2 className="size-4 text-muted-foreground" />}
			/>
			<StatPanel
				label="Services"
				value={services?.total}
				isPending={isPending}
				icon={<Server className="size-4 text-muted-foreground" />}
				detail={
					services && (
						<>
							{services.running} running
							{services.error > 0 ? (
								<span className="text-destructive"> · {services.error} error</span>
							) : null}
						</>
					)
				}
			/>
			<StatPanel
				label="Deployments (24h)"
				value={deployments?.total}
				isPending={isPending}
				icon={<Rocket className="size-4 text-muted-foreground" />}
				detail={
					deployments && (
						<>
							{deployments.done} succeeded
							{deployments.error > 0 ? (
								<span className="text-destructive"> · {deployments.error} failed</span>
							) : null}
						</>
					)
				}
			/>
			<DockerStatPanel />
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
			className="block rounded-lg border border-border p-3 transition-colors hover:border-foreground/20 sm:p-4"
		>
			<div className="flex items-center justify-between gap-2">
				<p className="truncate text-xs font-medium text-foreground sm:text-sm">Docker</p>
				<Container className="size-4 text-muted-foreground" />
			</div>
			<div className="mt-1 text-xl font-semibold tabular-nums tracking-tight sm:mt-2 sm:text-2xl">
				{containersQuery.isPending ? (
					<Skeleton className="h-7 w-14 sm:h-8 sm:w-16" />
				) : containersQuery.isError ? (
					<span className="text-sm font-normal text-muted-foreground">Offline</span>
				) : (
					running
				)}
			</div>
			{!containersQuery.isPending && !containersQuery.isError ? (
				<p className="mt-1 text-xs text-muted-foreground">
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
	const deployments = all.slice(0, 8);

	// Flash a row once when its status flips between polls (running → done/error).
	const previousStatuses = useRef(new Map<string, string>());
	const [flashed, setFlashed] = useState<ReadonlySet<string>>(new Set());
	useEffect(() => {
		const next = new Set<string>();
		for (const deployment of deployments) {
			const previous = previousStatuses.current.get(deployment.deploymentId);
			if (previous && previous !== deployment.status) {
				next.add(deployment.deploymentId);
			}
		}
		previousStatuses.current = new Map(
			deployments.map((deployment) => [deployment.deploymentId, deployment.status]),
		);
		if (next.size > 0) {
			setFlashed((current) => new Set([...current, ...next]));
		}
	}, [deployments]);

	const clearFlash = (deploymentId: string) => {
		setFlashed((current) => {
			if (!current.has(deploymentId)) {
				return current;
			}
			const next = new Set(current);
			next.delete(deploymentId);
			return next;
		});
	};

	return (
		<section className="flex h-full flex-col rounded-lg border border-border p-4 sm:p-5">
			<style>
				{`@keyframes nixploy-row-flash {
	from { background-color: var(--secondary); }
	to { background-color: transparent; }
}`}
			</style>
			<div className="mb-4 space-y-1">
				<h3 className="text-sm font-medium">Recent deployments</h3>
				<p className="text-sm text-muted-foreground">
					{isPending
						? "Loading…"
						: deployments.length === 0
							? "No deployments yet"
							: "Latest across your organization"}
				</p>
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
				<div className="space-y-1">
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
								<span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border">
									<StatusDot status={deploymentStatusDot[deployment.status] ?? "neutral"} />
								</span>
								<div className="min-w-0 flex-1 space-y-0.5">
									<p className="truncate text-sm font-medium leading-none">{name}</p>
									<p className="truncate text-xs text-muted-foreground">
										{deployment.project.name} · <span className="capitalize">{serviceType}</span> ·{" "}
										{deploymentStatusLabel[deployment.status] ?? deployment.status}
									</p>
								</div>
								<DateTime
									value={deployment.createdAt}
									className="ms-auto text-xs whitespace-nowrap text-muted-foreground"
								/>
							</>
						);
						return href ? (
							<Link
								key={deployment.deploymentId}
								href={href}
								className="flex items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-muted/40"
								style={
									flashed.has(deployment.deploymentId)
										? { animation: "nixploy-row-flash 900ms ease-out" }
										: undefined
								}
								onAnimationEnd={() => clearFlash(deployment.deploymentId)}
							>
								{inner}
							</Link>
						) : (
							<div
								key={deployment.deploymentId}
								className="flex items-center gap-3 px-1 py-2"
								style={
									flashed.has(deployment.deploymentId)
										? { animation: "nixploy-row-flash 900ms ease-out" }
										: undefined
								}
								onAnimationEnd={() => clearFlash(deployment.deploymentId)}
							>
								{inner}
							</div>
						);
					})}
				</div>
			</QueryState>
		</section>
	);
}

/** Docker daemon health: running containers + reclaimable space, links to the Docker tab. */
export function DockerHealthCard() {
	const trpc = useTRPC();
	const containersQuery = useQuery(trpc.docker.containers.queryOptions({}));
	const infoQuery = useQuery(trpc.docker.systemInfo.queryOptions({}));

	const containers = containersQuery.data ?? [];
	const running = containers.filter((container) => container.State === "running").length;
	const reclaimable = (infoQuery.data?.df ?? [])
		.map((row) => row.Reclaimable)
		.find((value) => value && value !== "0B");

	return (
		<section className="rounded-lg border border-border p-4 sm:p-5">
			<div className="mb-3 space-y-1">
				<h3 className="text-sm font-medium">Docker</h3>
				<p className="text-sm text-muted-foreground">Daemon health on this host</p>
			</div>
			<Link
				href="/dashboard/docker"
				className="block space-y-3 transition-opacity hover:opacity-80"
			>
				{containersQuery.isPending ? (
					<Skeleton className="h-8 w-24" />
				) : containersQuery.isError ? (
					<span className="text-sm text-muted-foreground">Daemon unreachable</span>
				) : (
					<span className="text-2xl font-semibold tabular-nums">
						{running}
						<span className="text-base font-normal text-muted-foreground">
							{" "}
							/ {containers.length} running
						</span>
					</span>
				)}
				<p className="text-xs text-muted-foreground">
					{infoQuery.data?.version?.Server?.Version
						? `Engine ${infoQuery.data.version.Server.Version}`
						: "Engine —"}
					{reclaimable ? ` · ${reclaimable} reclaimable` : ""}
				</p>
				<span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
					Open Docker
					<ChevronRight className="size-4" />
				</span>
			</Link>
		</section>
	);
}
