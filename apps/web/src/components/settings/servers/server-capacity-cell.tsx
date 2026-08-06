"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { useTRPC } from "@/lib/trpc";

function formatBytes(bytes: number): string {
	if (!bytes) return "—";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const index = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
	return `${(bytes / 2 ** (10 * index)).toFixed(0)} ${units[index]}`;
}

/** Inline CPU / memory capacity for the servers table. */
export function ServerCapacityCell({ serverId }: { serverId: string }) {
	const trpc = useTRPC();
	const { data, isPending, isError } = useQuery({
		...trpc.server.getStats.queryOptions({ serverId }),
		retry: false,
		staleTime: 30_000,
	});

	if (isPending) {
		return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
	}
	if (isError || !data) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}

	const usedPct =
		data.memory.totalBytes > 0
			? Math.round((data.memory.usedBytes / data.memory.totalBytes) * 100)
			: 0;

	return (
		<div className="text-xs leading-tight">
			<div>
				{data.cpus} CPU · {formatBytes(data.memory.totalBytes)}
			</div>
			<div className="text-muted-foreground">
				{usedPct}% mem · {data.containersRunning} ctr
			</div>
		</div>
	);
}
