"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Container, FolderGit2, Rocket, Server } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const deploymentStatusDot: Record<string, StatusDotStatus> = {
	running: "info",
	done: "success",
	error: "error",
	cancelled: "neutral",
};

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
		<div className={cn("rounded-lg border border-border p-4", className)}>
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm font-medium text-foreground">{label}</p>
				{icon}
			</div>
			<div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
				{isPending ? <Skeleton className="h-8 w-16" /> : (value ?? 0)}
			</div>
			{!isPending && detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
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
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
			className="block rounded-lg border border-border p-4 transition-colors hover:border-foreground/20"
		>
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm font-medium text-foreground">Docker</p>
				<Container className="size-4 text-muted-foreground" />
			</div>
			<div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
				{containersQuery.isPending ? (
					<Skeleton className="h-8 w-16" />
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
	const trpc = useTRPC();
	const { data, isPending, isError, error, refetch } = useQuery(
		trpc.deployment.recent.queryOptions({ limit: 8 }),
	);
	const deployments = data?.deployments ?? [];

	return (
		<section className="flex h-full flex-col rounded-lg border border-border p-4 sm:p-5">
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
									<p className="truncate text-xs text-muted-foreground capitalize">
										{deployment.project.name} · {serviceType} · {deployment.status}
									</p>
								</div>
								<div className="ms-auto text-xs whitespace-nowrap text-muted-foreground">
									{formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true })}
								</div>
							</>
						);
						return href ? (
							<Link
								key={deployment.deploymentId}
								href={href}
								className="flex items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-muted/40"
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
