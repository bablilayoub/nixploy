"use client";

import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

const chartConfig = {
	done: {
		label: "Succeeded",
		color: "var(--chart-2)",
	},
	error: {
		label: "Failed",
		color: "var(--destructive)",
	},
} satisfies ChartConfig;

/** Deployments per day (14d), done vs error — dashboard trend panel. */
export function DeploymentsChart() {
	const trpc = useTRPC();
	const { data, isPending } = useQuery(trpc.deployment.daily.queryOptions({ days: 14 }));
	const rows = (data ?? []).map((row) => ({
		...row,
		label: row.date.slice(5), // MM-DD
	}));

	return (
		<section className="flex h-full flex-col rounded-lg border border-border p-4 sm:p-5">
			<div className="mb-4 space-y-1">
				<h3 className="text-sm font-medium">Overview</h3>
				<p className="text-sm text-muted-foreground">Deployments over the last 14 days</p>
			</div>
			<div className="ps-2">
				{isPending ? (
					<Skeleton className="h-[220px] w-full" />
				) : (
					<ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
						<AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
							<defs>
								<linearGradient id="dash-done" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="var(--color-done)" stopOpacity={0.3} />
									<stop offset="100%" stopColor="var(--color-done)" stopOpacity={0.02} />
								</linearGradient>
								<linearGradient id="dash-error" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="var(--color-error)" stopOpacity={0.3} />
									<stop offset="100%" stopColor="var(--color-error)" stopOpacity={0.02} />
								</linearGradient>
							</defs>
							<CartesianGrid strokeDasharray="3 3" vertical={false} />
							<XAxis
								dataKey="label"
								tickLine={false}
								axisLine={false}
								minTickGap={24}
								tickMargin={6}
								fontSize={10}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								width={28}
								allowDecimals={false}
								fontSize={10}
							/>
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Area
								type="monotone"
								dataKey="done"
								stroke="var(--color-done)"
								fill="url(#dash-done)"
								strokeWidth={1.5}
								isAnimationActive={false}
							/>
							<Area
								type="monotone"
								dataKey="error"
								stroke="var(--color-error)"
								fill="url(#dash-error)"
								strokeWidth={1.5}
								isAnimationActive={false}
							/>
						</AreaChart>
					</ChartContainer>
				)}
			</div>
		</section>
	);
}
