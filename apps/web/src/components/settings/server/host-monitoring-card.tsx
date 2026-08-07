"use client";

import { useQuery } from "@tanstack/react-query";
import { Cpu, Database, HardDrive, MemoryStick } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

function formatBytes(bytes: number): string {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const index = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
	return `${(bytes / 2 ** (10 * index)).toFixed(1)} ${units[index]}`;
}

function Meter({
	icon: Icon,
	label,
	value,
	percent,
	detail,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
	percent: number | null;
	detail?: string;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border p-4">
			<div className="flex items-center gap-2 text-muted-foreground">
				<Icon className="size-4" />
				<span className="text-xs font-medium uppercase tracking-wide">{label}</span>
			</div>
			<p className="text-lg font-semibold tabular-nums">{value}</p>
			{percent !== null && (
				<div className="h-1.5 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-foreground transition-[width] duration-500"
						style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
					/>
				</div>
			)}
			{detail && <p className="text-xs text-muted-foreground">{detail}</p>}
		</div>
	);
}

/** Live metrics of the Nixploy host itself (not the managed remote servers). */
export function HostMonitoringCard() {
	const trpc = useTRPC();
	const statsQuery = useQuery({
		...trpc.monitoring.serverStats.queryOptions({}),
		refetchInterval: 30_000,
		retry: false,
	});
	const stats = statsQuery.data;

	const memoryPercent = stats?.memory.totalBytes
		? (stats.memory.usedBytes / stats.memory.totalBytes) * 100
		: null;
	const diskPercent = stats?.disk.totalBytes
		? (stats.disk.usedBytes / stats.disk.totalBytes) * 100
		: null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Host monitoring</CardTitle>
				<CardDescription>
					Live metrics from this Nixploy host. Refreshes every 30 seconds.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				{statsQuery.isPending ? (
					<div className="grid gap-4 sm:grid-cols-3">
						<Skeleton className="h-28 w-full" />
						<Skeleton className="h-28 w-full" />
						<Skeleton className="h-28 w-full" />
					</div>
				) : !stats ? (
					<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-6 text-center">
						<p className="text-sm text-muted-foreground">
							Unable to read host metrics
							{statsQuery.error ? `: ${statsQuery.error.message}` : "."}
						</p>
						<Button size="sm" variant="outline" onClick={() => statsQuery.refetch()}>
							Retry
						</Button>
					</div>
				) : (
					<>
						<div className="grid gap-4 sm:grid-cols-3">
							<Meter
								icon={MemoryStick}
								label="Memory"
								value={`${formatBytes(stats.memory.usedBytes)} / ${formatBytes(stats.memory.totalBytes)}`}
								percent={memoryPercent}
								detail={memoryPercent !== null ? `${memoryPercent.toFixed(0)}% used` : undefined}
							/>
							<Meter
								icon={HardDrive}
								label="Disk"
								value={
									stats.disk.totalBytes
										? `${formatBytes(stats.disk.usedBytes)} / ${formatBytes(stats.disk.totalBytes)}`
										: "Unavailable"
								}
								percent={diskPercent}
								detail={
									stats.disk.totalBytes
										? stats.disk.usedPercent
											? `${stats.disk.usedPercent} used`
											: undefined
										: "Could not read filesystem usage"
								}
							/>
							<Meter
								icon={Cpu}
								label="Load average"
								value={stats.loadAverage.map((v) => v.toFixed(2)).join("  ")}
								percent={null}
								detail={`1 / 5 / 15 min · ${stats.cpus} CPUs (${stats.architecture})`}
							/>
						</div>
						<div className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
							<div className="flex justify-between gap-4">
								<span className="text-muted-foreground">Docker</span>
								<span>{stats.dockerVersion || "—"}</span>
							</div>
							<div className="flex justify-between gap-4">
								<span className="text-muted-foreground">OS</span>
								<span className="truncate">{stats.operatingSystem || "—"}</span>
							</div>
							<div className="flex justify-between gap-4">
								<span className="flex items-center gap-1.5 text-muted-foreground">
									<Database className="size-3.5" />
									Containers
								</span>
								<span>
									{stats.containersRunning} running / {stats.containers} total
								</span>
							</div>
							<div className="flex justify-between gap-4">
								<span className="text-muted-foreground">Images</span>
								<span>{stats.images}</span>
							</div>
							{stats.swarmNodeState && (
								<div className="flex justify-between gap-4">
									<span className="text-muted-foreground">Swarm</span>
									<span className="capitalize">{stats.swarmNodeState}</span>
								</div>
							)}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
