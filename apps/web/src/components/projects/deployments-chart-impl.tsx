"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
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
	const [days, setDays] = useState(14);
	const { data, isPending, isError, error, refetch } = useQuery(
		trpc.deployment.daily.queryOptions({ days }),
	);
	const rows = (data ?? []).map((row) => ({
		...row,
		label: new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			timeZone: "UTC",
		}).format(new Date(`${row.date}T00:00:00Z`)),
	}));
	// A fortnight of flat zeroes is a chart that says nothing; a fresh instance
	// gets a sentence instead.
	const hasDeployments = rows.some((row) => row.done > 0 || row.error > 0);

	return (
		<section className="surface flex h-full min-w-0 flex-col p-5 sm:p-6">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div className="space-y-1">
					<h2 className="text-base font-medium tracking-tight">Deployment activity</h2>
					<p className="text-xs text-muted-foreground">Successful and failed builds by day.</p>
				</div>
				<fieldset
					className="flex min-w-0 max-w-full flex-wrap gap-1 rounded-md border bg-panel-inset p-1"
					aria-label="Activity period"
				>
					{[7, 14, 30].map((period) => (
						<Button
							key={period}
							size="sm"
							variant={days === period ? "secondary" : "ghost"}
							aria-pressed={days === period}
							onClick={() => setDays(period)}
							className="h-7 px-2 text-xs"
						>
							{period} days
						</Button>
					))}
				</fieldset>
			</div>
			<p className="sr-only">
				{rows.reduce((total, row) => total + row.done, 0)} succeeded and{" "}
				{rows.reduce((total, row) => total + row.error, 0)} failed deployments over the last {days}{" "}
				days.
			</p>
			<div className="min-w-0 ps-2">
				{isPending ? (
					<Skeleton className="h-[220px] w-full" />
				) : isError ? (
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
				) : !hasDeployments ? (
					<div className="flex h-[220px] items-center justify-center text-center text-sm text-muted-foreground">
						No deployments in the last {days} days.
					</div>
				) : (
					<ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
						<BarChart
							aria-label="Daily deployment activity, succeeded and failed"
							data={rows}
							margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
						>
							<CartesianGrid strokeDasharray="2 6" vertical={false} />
							<XAxis
								dataKey="label"
								tickLine={false}
								axisLine={false}
								minTickGap={24}
								tickMargin={6}
								fontSize={11}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								width={28}
								allowDecimals={false}
								fontSize={11}
							/>
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Bar
								dataKey="done"
								fill="var(--color-done)"
								radius={[4, 4, 0, 0]}
								maxBarSize={32}
								isAnimationActive={false}
							/>
							<Bar
								dataKey="error"
								fill="var(--color-error)"
								radius={[4, 4, 0, 0]}
								maxBarSize={32}
								isAnimationActive={false}
							/>
						</BarChart>
					</ChartContainer>
				)}
			</div>
		</section>
	);
}
