"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Container, Rocket } from "lucide-react";
import Link from "next/link";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { QueryState } from "@/components/query-state";
import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

const deploymentStatusDot: Record<string, StatusDotStatus> = {
	running: "info",
	done: "success",
	error: "error",
	cancelled: "neutral",
};

function StatCard({
	label,
	value,
	detail,
	isPending,
}: {
	label: string;
	value: number | undefined;
	detail?: React.ReactNode;
	isPending: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 rounded-xl border p-5">
			<span className="text-sm text-muted-foreground">{label}</span>
			{isPending ? (
				<Skeleton className="h-8 w-16" />
			) : (
				<span className="text-2xl font-semibold tabular-nums">{value ?? 0}</span>
			)}
			{!isPending && detail && <span className="text-xs text-muted-foreground">{detail}</span>}
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
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
			<StatCard label="Projects" value={data?.projectCount} isPending={isPending} />
			<StatCard
				label="Services"
				value={services?.total}
				isPending={isPending}
				detail={
					services && (
						<>
							{services.running} running
							{services.error > 0 && (
								<span className="text-destructive"> · {services.error} error</span>
							)}
						</>
					)
				}
			/>
			<StatCard
				label="Deployments (24h)"
				value={deployments?.total}
				isPending={isPending}
				detail={
					deployments && (
						<>
							{deployments.done} succeeded
							{deployments.error > 0 && (
								<span className="text-destructive"> · {deployments.error} failed</span>
							)}
						</>
					)
				}
			/>
		</div>
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
		<div className="flex flex-col gap-3">
			<h2 className="text-sm font-medium text-muted-foreground">Recent Deployments</h2>
			<QueryState
				isPending={isPending}
				isError={isError}
				error={error}
				onRetry={() => refetch()}
				isEmpty={deployments.length === 0}
				skeleton={
					<div className="divide-y rounded-xl border">
						{Array.from({ length: 4 }).map((_, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
							<div key={index} className="flex items-center gap-4 px-4 py-3">
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-4 w-40" />
							</div>
						))}
					</div>
				}
				empty={
					<div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
						<Rocket className="size-4 shrink-0" />
						No deployments yet — deploy a service and it will show up here.
					</div>
				}
			>
				<div className="divide-y rounded-xl border">
					{deployments.map((deployment) => {
						const serviceType = deployment.service.type;
						const serviceId =
							serviceType === "application" ? deployment.applicationId : deployment.composeId;
						const href = serviceId
							? `/dashboard/projects/${deployment.project.projectId}/services/${serviceType}/${serviceId}`
							: null;
						const inner = (
							<>
								<span className="flex w-28 shrink-0 items-center gap-2 text-sm capitalize">
									<StatusDot status={deploymentStatusDot[deployment.status] ?? "neutral"} />
									{deployment.status}
								</span>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="truncate text-sm font-medium">
										{deployment.service.name ?? deployment.service.appName ?? "Service"}
									</span>
									<span className="truncate text-xs text-muted-foreground capitalize">
										{deployment.project.name} · {serviceType} · {deployment.environment.name}
									</span>
								</span>
								<span className="hidden w-28 shrink-0 text-right text-sm text-muted-foreground sm:block">
									{formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true })}
								</span>
								<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
							</>
						);
						return href ? (
							<Link
								key={deployment.deploymentId}
								href={href}
								className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-secondary"
							>
								{inner}
							</Link>
						) : (
							<div key={deployment.deploymentId} className="flex items-center gap-4 px-4 py-3">
								{inner}
							</div>
						);
					})}
				</div>
			</QueryState>
		</div>
	);
}

const chartTooltipStyle = {
	backgroundColor: "var(--card)",
	border: "1px solid var(--border)",
	borderRadius: "10px",
	fontSize: "12px",
	color: "var(--foreground)",
} as const;

/** Deployments per day (14d), done vs error — dashboard trend card. */
export function DeploymentsChart() {
	const trpc = useTRPC();
	const { data, isPending } = useQuery(trpc.deployment.daily.queryOptions({ days: 14 }));
	const rows = (data ?? []).map((row) => ({
		...row,
		label: row.date.slice(5), // MM-DD
	}));

	return (
		<div className="flex flex-col gap-3 rounded-xl border p-5">
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">Deployments — last 14 days</span>
				<div className="flex items-center gap-3 text-xs text-muted-foreground">
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-emerald-500" /> Succeeded
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-red-500" /> Failed
					</span>
				</div>
			</div>
			<div className="h-40">
				{isPending ? (
					<Skeleton className="h-full w-full" />
				) : (
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
							<defs>
								<linearGradient id="dash-done" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#17c964" stopOpacity={0.3} />
									<stop offset="100%" stopColor="#17c964" stopOpacity={0.02} />
								</linearGradient>
								<linearGradient id="dash-error" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#f31260" stopOpacity={0.3} />
									<stop offset="100%" stopColor="#f31260" stopOpacity={0.02} />
								</linearGradient>
							</defs>
							<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
							<XAxis
								dataKey="label"
								stroke="var(--muted-foreground)"
								fontSize={10}
								tickLine={false}
								axisLine={false}
								minTickGap={24}
							/>
							<YAxis
								stroke="var(--muted-foreground)"
								fontSize={10}
								tickLine={false}
								axisLine={false}
								width={28}
								allowDecimals={false}
							/>
							<Tooltip contentStyle={chartTooltipStyle} />
							<Area
								type="monotone"
								dataKey="done"
								name="Succeeded"
								stroke="#17c964"
								fill="url(#dash-done)"
								strokeWidth={1.5}
								isAnimationActive={false}
							/>
							<Area
								type="monotone"
								dataKey="error"
								name="Failed"
								stroke="#f31260"
								fill="url(#dash-error)"
								strokeWidth={1.5}
								isAnimationActive={false}
							/>
						</AreaChart>
					</ResponsiveContainer>
				)}
			</div>
		</div>
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
		<Link
			href="/dashboard/docker"
			className="flex flex-col gap-3 rounded-xl border p-5 transition-colors hover:bg-secondary/50"
		>
			<div className="flex items-center justify-between">
				<span className="text-sm text-muted-foreground">Docker</span>
				<Container className="size-4 text-muted-foreground" />
			</div>
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
			<span className="text-xs text-muted-foreground">
				{infoQuery.data?.version?.Server?.Version
					? `Engine ${infoQuery.data.version.Server.Version}`
					: "Engine —"}
				{reclaimable ? ` · ${reclaimable} reclaimable` : ""}
			</span>
		</Link>
	);
}
