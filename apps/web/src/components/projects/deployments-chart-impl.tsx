"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

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
