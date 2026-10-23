"use client";

import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { formatBytes } from "@/lib/format";

/**
 * Host-level history for one managed server (`monitoring.serverHistory`),
 * sampled over SSH by the metrics-history cron. Three stacked area charts —
 * CPU, memory, disk — so the y axes stay honest (percent vs bytes).
 * Loaded through `next/dynamic` by `server-history-dialog.tsx` to keep
 * Recharts out of the settings bundle.
 */

export interface ServerHistorySample {
	t: number;
	cpuPercent: number;
	memoryUsed: number;
	memoryTotal: number;
	diskUsed: number;
	diskTotal: number;
}

interface Row {
	time: string;
	cpu: number;
	memoryPercent: number;
	memoryUsed: number;
	diskPercent: number;
	diskUsed: number;
}

const COLORS = {
	cpu: "#0070f3",
	memory: "#17c964",
	disk: "#f5a524",
} as const;

const tooltipStyle = {
	backgroundColor: "var(--card)",
	border: "1px solid var(--border)",
	borderRadius: "10px",
	fontSize: "12px",
	color: "var(--foreground)",
} as const;

const percent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

function Panel({
	title,
	value,
	rows,
	dataKey,
	color,
	id,
	formatValue,
}: {
	title: string;
	value: string;
	rows: Row[];
	dataKey: keyof Row;
	color: string;
	id: string;
	formatValue: (value: number) => string;
}) {
	return (
		<div className="rounded-lg border border-border p-3">
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-sm font-medium">{title}</p>
				<p className="font-mono text-xs text-muted-foreground">{value}</p>
			</div>
			<div className="mt-2 h-36">
				<ResponsiveContainer width="100%" height="100%">
					<AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
						<defs>
							<linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor={color} stopOpacity={0.28} />
								<stop offset="100%" stopColor={color} stopOpacity={0.02} />
							</linearGradient>
						</defs>
						<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
						<XAxis
							dataKey="time"
							tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
							stroke="var(--border)"
							minTickGap={24}
						/>
						<YAxis
							domain={[0, 100]}
							tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
							stroke="var(--border)"
							width={34}
							tickFormatter={(tick: number) => `${Math.round(tick)}%`}
						/>
						<Tooltip
							contentStyle={tooltipStyle}
							formatter={(raw) => formatValue(Number(raw))}
							labelStyle={{ color: "var(--muted-foreground)" }}
						/>
						<Area
							type="monotone"
							dataKey={dataKey}
							name={title}
							stroke={color}
							strokeWidth={1.5}
							fill={`url(#${id})`}
							isAnimationActive={false}
						/>
					</AreaChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

export function ServerHistoryChart({ samples }: { samples: ServerHistorySample[] }) {
	const rows: Row[] = samples.map((sample) => ({
		time: new Date(sample.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
		cpu: Number(sample.cpuPercent.toFixed(2)),
		memoryPercent: Number(percent(sample.memoryUsed, sample.memoryTotal).toFixed(2)),
		memoryUsed: sample.memoryUsed,
		diskPercent: Number(percent(sample.diskUsed, sample.diskTotal).toFixed(2)),
		diskUsed: sample.diskUsed,
	}));
	const last = samples[samples.length - 1];

	return (
		<div className="grid gap-3">
			<Panel
				title="CPU"
				value={last ? `${last.cpuPercent.toFixed(1)}%` : "—"}
				rows={rows}
				dataKey="cpu"
				color={COLORS.cpu}
				id="server-history-cpu"
				formatValue={(value) => `${value.toFixed(1)}%`}
			/>
			<Panel
				title="Memory"
				value={last ? `${formatBytes(last.memoryUsed)} / ${formatBytes(last.memoryTotal)}` : "—"}
				rows={rows}
				dataKey="memoryPercent"
				color={COLORS.memory}
				id="server-history-memory"
				formatValue={(value) => `${value.toFixed(1)}%`}
			/>
			<Panel
				title="Disk (/)"
				value={last ? `${formatBytes(last.diskUsed)} / ${formatBytes(last.diskTotal)}` : "—"}
				rows={rows}
				dataKey="diskPercent"
				color={COLORS.disk}
				id="server-history-disk"
				formatValue={(value) => `${value.toFixed(1)}%`}
			/>
		</div>
	);
}
