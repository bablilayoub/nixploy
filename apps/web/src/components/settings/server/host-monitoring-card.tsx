"use client";

import { useQuery } from "@tanstack/react-query";
import { Cpu, HardDrive, MemoryStick } from "lucide-react";

import { Button } from "@/components/ui/button";
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
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
	percent: number | null;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 text-muted-foreground">
				<Icon className="size-3.5" />
				<span className="text-xs">{label}</span>
			</div>
			<p className="text-sm font-medium tabular-nums">{value}</p>
			{percent !== null && (
				<div className="h-1 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-foreground/80 transition-[width] duration-500"
						style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
					/>
				</div>
			)}
		</div>
	);
}

/** Compact live metrics for the Nixploy host. */
export function HostMonitoringBody() {
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

	if (statsQuery.isPending) {
		return <Skeleton className="h-16 w-full" />;
	}

	if (!stats) {
		return (
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<span>
					Unable to read host metrics{statsQuery.error ? `: ${statsQuery.error.message}` : "."}
				</span>
				<Button size="sm" variant="outline" onClick={() => statsQuery.refetch()}>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<div className="grid gap-4 sm:grid-cols-3">
			<Meter
				icon={MemoryStick}
				label="Memory"
				value={
					memoryPercent !== null
						? `${memoryPercent.toFixed(0)}% · ${formatBytes(stats.memory.usedBytes)}`
						: formatBytes(stats.memory.usedBytes)
				}
				percent={memoryPercent}
			/>
			<Meter
				icon={HardDrive}
				label="Disk"
				value={
					stats.disk.totalBytes
						? diskPercent !== null
							? `${diskPercent.toFixed(0)}% · ${formatBytes(stats.disk.usedBytes)}`
							: formatBytes(stats.disk.usedBytes)
						: "Unavailable"
				}
				percent={diskPercent}
			/>
			<Meter
				icon={Cpu}
				label="Load"
				value={stats.loadAverage.map((v) => v.toFixed(2)).join(" / ")}
				percent={null}
			/>
		</div>
	);
}
