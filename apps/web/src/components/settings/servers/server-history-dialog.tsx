"use client";

import { useQuery } from "@tanstack/react-query";
import { ChartSpline } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTRPC } from "@/lib/trpc";

/** Lazy Recharts — the settings page must not pay for it until a chart opens. */
const ServerHistoryChart = dynamic(
	() => import("./server-history-chart").then((m) => m.ServerHistoryChart),
	{ ssr: false, loading: () => <Skeleton className="h-[26rem] w-full rounded-lg" /> },
);

const RANGES = [
	{ value: "1", label: "Last hour" },
	{ value: "6", label: "Last 6 hours" },
	{ value: "24", label: "Last 24 hours" },
	{ value: "48", label: "Last 48 hours" },
];

/**
 * "Metrics history" for a managed server: cpu/memory/disk samples written by
 * the metrics-history cron into `<config>/metrics/server-<id>.jsonl` and read
 * back by `monitoring.serverHistory`. Empty until the cron has run at least
 * once (and it only samples servers with metrics enabled), so the empty state
 * says so instead of looking broken.
 */
export function ServerHistoryDialog({
	serverId,
	serverName,
	metricsEnabled,
}: {
	serverId: string;
	serverName: string;
	metricsEnabled: boolean;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [hours, setHours] = useState("6");

	const historyQuery = useQuery({
		...trpc.monitoring.serverHistory.queryOptions({ serverId, hours: Number(hours) }),
		enabled: open,
		retry: false,
	});

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
						<ChartSpline className="size-4" />
						<span className="sr-only">Metrics history</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent>Metrics history</TooltipContent>
			</Tooltip>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Metrics history — {serverName}</DialogTitle>
						<DialogDescription>
							Host cpu, memory and disk sampled over SSH every 30 seconds and kept for 48 hours.
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center justify-end">
						<Select value={hours} onValueChange={setHours}>
							<SelectTrigger className="w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{RANGES.map((range) => (
									<SelectItem key={range.value} value={range.value}>
										{range.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<QueryState
						isPending={historyQuery.isPending}
						isError={historyQuery.isError}
						error={historyQuery.error}
						onRetry={() => historyQuery.refetch()}
						skeleton={<Skeleton className="h-[26rem] w-full rounded-lg" />}
						isEmpty={(historyQuery.data ?? []).length === 0}
						empty={
							<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
								<ChartSpline className="size-8 text-muted-foreground" />
								<p className="text-sm font-medium">No samples yet</p>
								<p className="max-w-sm text-sm text-muted-foreground">
									{metricsEnabled
										? "The metrics cron writes a sample every 30 seconds; check back shortly after the server was added."
										: "Metrics collection is disabled for this server — enable it in Edit server."}
								</p>
							</div>
						}
					>
						<ServerHistoryChart samples={historyQuery.data ?? []} />
					</QueryState>
				</DialogContent>
			</Dialog>
		</>
	);
}
