"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useTRPC } from "@/lib/trpc";

function formatBytes(bytes: number): string {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const index = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
	return `${(bytes / 2 ** (10 * index)).toFixed(1)} ${units[index]}`;
}

export function ServerStatsPopover({ serverId }: { serverId: string }) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);

	const { data: stats, isPending } = useQuery({
		...trpc.server.getStats.queryOptions({ serverId }),
		enabled: open,
		retry: false,
	});

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="icon">
					<Activity className="size-4" />
					<span className="sr-only">Server stats</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80" align="end">
				<PopoverHeader>
					<PopoverTitle>Server stats</PopoverTitle>
					<PopoverDescription>Live metrics collected over SSH.</PopoverDescription>
				</PopoverHeader>
				{isPending ? (
					<div className="flex items-center justify-center py-6">
						<Loader2 className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : !stats ? (
					<p className="py-4 text-center text-sm text-muted-foreground">Unable to load stats.</p>
				) : (
					<div className="grid gap-1.5 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Docker</span>
							<span>{stats.dockerVersion || "—"}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">OS</span>
							<span className="max-w-40 truncate">{stats.operatingSystem || "—"}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">CPUs</span>
							<span>
								{stats.cpus} ({stats.architecture})
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Memory</span>
							<span>
								{formatBytes(stats.memory.usedBytes)} / {formatBytes(stats.memory.totalBytes)}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Containers</span>
							<span>
								{stats.containersRunning} running / {stats.containers} total
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Images</span>
							<span>{stats.images}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Swarm</span>
							<span>{stats.swarmNodeState || "—"}</span>
						</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
