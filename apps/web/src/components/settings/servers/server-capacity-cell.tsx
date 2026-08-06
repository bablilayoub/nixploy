"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Loader2 } from "lucide-react";

import type { AppRouter } from "@/lib/trpc-types";

type ServerStats = inferRouterOutputs<AppRouter>["server"]["getStats"];

function formatBytes(bytes: number): string {
	if (!bytes) return "—";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const index = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
	return `${(bytes / 2 ** (10 * index)).toFixed(0)} ${units[index]}`;
}

/** Inline CPU / memory capacity for the servers table (fed from getStatsBatch). */
export function ServerCapacityCell({
	stats,
	isPending,
}: {
	stats: ServerStats | null | undefined;
	isPending: boolean;
}) {
	if (isPending) {
		return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
	}
	if (!stats) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}

	const usedPct =
		stats.memory.totalBytes > 0
			? Math.round((stats.memory.usedBytes / stats.memory.totalBytes) * 100)
			: 0;

	return (
		<div className="text-xs leading-tight">
			<div>
				{stats.cpus} CPU · {formatBytes(stats.memory.totalBytes)}
			</div>
			<div className="text-muted-foreground">
				{usedPct}% mem · {stats.containersRunning} ctr
			</div>
		</div>
	);
}
