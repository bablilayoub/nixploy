"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Loader2, Rocket } from "lucide-react";
import Link from "next/link";

import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";

const deploymentStatusDot: Record<string, StatusDotStatus> = {
	running: "info",
	done: "success",
	error: "error",
	cancelled: "neutral",
};

function formatDuration(startedAt: Date | null, finishedAt: Date | null) {
	if (!finishedAt) {
		return "—";
	}
	const start = startedAt ? new Date(startedAt).getTime() : new Date(finishedAt).getTime();
	const seconds = Math.max(0, Math.round((new Date(finishedAt).getTime() - start) / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StatCard({
	label,
	value,
	dot,
	isPending,
}: {
	label: string;
	value: number | undefined;
	dot: StatusDotStatus;
	isPending?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 rounded-lg border p-4">
			<span className="flex items-center gap-2 text-sm text-muted-foreground">
				<StatusDot status={dot} />
				{label}
			</span>
			{isPending ? (
				<Skeleton className="h-8 w-12" />
			) : (
				<span className="text-2xl font-semibold tabular-nums">{value ?? 0}</span>
			)}
		</div>
	);
}

/**
 * Project-wide deployments feed — keyset-paginated table with a small
 * stats row (running / done / error / total).
 */
export function DeploymentsTab({ projectId }: { projectId: string }) {
	const trpc = useTRPC();

	const statsQuery = useQuery(trpc.deployment.statsByProject.queryOptions({ projectId }));

	const deploymentsQuery = useInfiniteQuery(
		trpc.deployment.byProject.infiniteQueryOptions(
			{ projectId, limit: 20 },
			{ getNextPageParam: (lastPage) => lastPage.nextCursor },
		),
	);

	const stats = statsQuery.data;
	const deployments = deploymentsQuery.data?.pages.flatMap((page) => page.deployments) ?? [];

	return (
		<div className="flex flex-col gap-6">
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard
					label="Running"
					value={stats?.running}
					dot="info"
					isPending={statsQuery.isPending}
				/>
				<StatCard label="Done" value={stats?.done} dot="success" isPending={statsQuery.isPending} />
				<StatCard label="Error" value={stats?.error} dot="error" isPending={statsQuery.isPending} />
				<StatCard
					label="Total"
					value={stats?.total}
					dot="neutral"
					isPending={statsQuery.isPending}
				/>
			</div>

			{deploymentsQuery.isPending ? (
				<div className="divide-y rounded-lg border">
					{Array.from({ length: 5 }).map((_, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
						<div key={index} className="flex items-center gap-4 px-4 py-3">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-4 w-40" />
						</div>
					))}
				</div>
			) : deployments.length > 0 ? (
				<>
					<div className="overflow-hidden rounded-lg border">
						<Table>
							<TableBody>
								{deployments.map((deployment) => {
									const serviceType = deployment.service.type;
									const serviceId =
										serviceType === "application" ? deployment.applicationId : deployment.composeId;
									const href = serviceId
										? `/dashboard/projects/${projectId}/services/${serviceType}/${serviceId}`
										: null;
									return (
										<TableRow key={deployment.deploymentId}>
											<TableCell className="w-32">
												<span className="flex items-center gap-2 text-sm capitalize">
													<StatusDot status={deploymentStatusDot[deployment.status] ?? "neutral"} />
													{deployment.status}
												</span>
											</TableCell>
											<TableCell>
												<div className="flex min-w-0 flex-col">
													{href ? (
														<Link
															href={href}
															className="truncate text-sm font-medium hover:underline"
														>
															{deployment.service.name ?? deployment.service.appName ?? "Service"}
														</Link>
													) : (
														<span className="truncate text-sm font-medium">
															{deployment.service.name ?? deployment.service.appName ?? "Service"}
														</span>
													)}
													<span className="text-xs text-muted-foreground capitalize">
														{serviceType} · {deployment.environment.name}
													</span>
												</div>
											</TableCell>
											<TableCell className="max-w-56 truncate text-sm text-muted-foreground">
												{deployment.title}
											</TableCell>
											<TableCell className="w-40 text-sm text-muted-foreground">
												{formatDistanceToNow(new Date(deployment.createdAt), {
													addSuffix: true,
												})}
											</TableCell>
											<TableCell className="w-24 text-right text-sm text-muted-foreground tabular-nums">
												{formatDuration(deployment.startedAt, deployment.finishedAt)}
											</TableCell>
											<TableCell className="w-10 text-right">
												{href && (
													<Link href={href} aria-label="Open service" className="inline-flex">
														<ChevronRight className="size-4 text-muted-foreground" />
													</Link>
												)}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
					{deploymentsQuery.hasNextPage && (
						<div className="flex justify-center">
							<Button
								variant="outline"
								size="sm"
								disabled={deploymentsQuery.isFetchingNextPage}
								onClick={() => deploymentsQuery.fetchNextPage()}
							>
								{deploymentsQuery.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
								Load more
							</Button>
						</div>
					)}
				</>
			) : (
				<div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
					<div className="flex size-12 items-center justify-center rounded-full bg-secondary">
						<Rocket className="size-6 text-muted-foreground" />
					</div>
					<div className="flex flex-col gap-1">
						<p className="font-medium">No deployments yet</p>
						<p className="text-sm text-muted-foreground">
							Deploy a service in this project and it will show up here.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
