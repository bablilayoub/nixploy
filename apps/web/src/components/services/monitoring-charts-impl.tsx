"use client";

import { SERVICE_EVENT_CHART_KINDS } from "@nixploy/server/modules/observability/event-kinds";
import type { ServiceKind } from "@nixploy/server/modules/services/kinds";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDown, ArrowUp, Cpu, Database, HardDrive, ListOrdered } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { SettingsSection } from "@/components/layout/settings-section";
import { NotRunningState, type RuntimeEmptyProps } from "@/components/services/not-running-state";
import { type ChartAnnotation, snapEventsToSamples } from "@/lib/chart-annotations";
import { formatBytes } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const MAX_SAMPLES = 60;

interface StatsFrame {
	cpu: number;
	memory: { used: number; total: number; percent: number };
	network: { rx: number; tx: number };
	block: { read: number; write: number };
	pids: number;
}

interface Sample {
	/** Epoch ms of the sample; the x axis is categorical, this is what events snap to. */
	at: number;
	time: string;
	cpu: number;
	memoryPercent: number;
	memoryUsed: number;
	rxRate: number;
	txRate: number;
	diskReadRate: number;
	diskWriteRate: number;
	pids: number;
}

function wsUrl(params: Record<string, string | null | undefined>) {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) search.set(key, value);
	}
	return `${protocol}//${window.location.host}/ws/stats?${search.toString()}`;
}

const tooltipStyle = {
	backgroundColor: "var(--card)",
	border: "1px solid var(--border)",
	borderRadius: "10px",
	fontSize: "12px",
	color: "var(--foreground)",
} as const;

const METRICS = {
	cpu: "#0070f3",
	memory: "#17c964",
	rx: "#f5a524",
	tx: "#8b5cf6",
	disk: "#f31260",
	pids: "#7c8b9c",
} as const;

/** Gradient fill definition for one series (solid at top → transparent). */
function SeriesGradient({ id, color }: { id: string; color: string }) {
	return (
		<linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stopColor={color} stopOpacity={0.28} />
			<stop offset="100%" stopColor={color} stopOpacity={0.02} />
		</linearGradient>
	);
}

/** Tiny axes-less trend strip used inside the KPI cards. */
function Sparkline({
	data,
	dataKey,
	color,
	id,
}: {
	data: Sample[];
	dataKey: keyof Sample;
	color: string;
	id: string;
}) {
	if (data.length < 2) return null;
	const values = data.map((sample) => Number(sample[dataKey]));
	const min = Math.min(...values);
	const max = Math.max(...values);
	// Flat series (idle service) — skip the empty-looking line.
	if (max - min < 1e-9) return null;
	return (
		<div className="h-7">
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
					<defs>
						<SeriesGradient id={id} color={color} />
					</defs>
					<Area
						type="monotone"
						dataKey={dataKey}
						stroke={color}
						strokeWidth={1.5}
						fill={`url(#${id})`}
						isAnimationActive={false}
					/>
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
}

function KpiCard({
	icon: Icon,
	label,
	value,
	sub,
	color,
	samples,
	dataKey,
	gradientId,
	meter,
}: {
	icon: typeof Cpu;
	label: string;
	value: string;
	sub?: string;
	color: string;
	samples: Sample[];
	dataKey: keyof Sample;
	gradientId: string;
	/** 0–100 fill for the thin meter under the value. */
	meter?: number;
}) {
	return (
		<div className="overflow-hidden rounded-lg border border-border px-3 py-3">
			<div className="flex items-center justify-between gap-2">
				<div
					className="flex size-7 items-center justify-center rounded-md"
					style={{ backgroundColor: `${color}1f`, color }}
				>
					<Icon className="size-3.5" />
				</div>
				<span className="text-[11px] font-medium text-muted-foreground">{label}</span>
			</div>
			<div className="mt-2">
				<p className="text-lg font-semibold tracking-tight tabular-nums">{value}</p>
				{sub ? (
					<p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</p>
				) : null}
			</div>
			<div className="mt-2">
				{meter != null ? (
					<div className="h-1 overflow-hidden rounded-full bg-secondary">
						<div
							className="h-full rounded-full transition-[width] duration-500"
							style={{ width: `${Math.min(Math.max(meter, 0), 100)}%`, backgroundColor: color }}
						/>
					</div>
				) : (
					<Sparkline data={samples} dataKey={dataKey} color={color} id={gradientId} />
				)}
			</div>
		</div>
	);
}

function MetricChart({
	title,
	latest,
	data,
	series,
	formatValue,
	annotations = [],
}: {
	title: string;
	/** Value chip shown on the right of the header (latest reading). */
	latest?: string;
	data: Sample[];
	series: { key: keyof Sample; label: string; color: string; gradientId: string }[];
	formatValue: (value: number) => string;
	annotations?: ChartAnnotation[];
}) {
	// Peak marker per series (dashed line at the window's max).
	const peaks = series.map((item) => ({
		key: item.key,
		color: item.color,
		value: data.reduce((peak, sample) => {
			const value = sample[item.key];
			return typeof value === "number" ? Math.max(peak, value) : peak;
		}, 0),
	}));
	return (
		<div className="space-y-3 rounded-lg border border-border p-4">
			<div className="flex items-center justify-between">
				<p className="text-sm font-medium">{title}</p>
				{latest ? (
					<span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs tabular-nums">
						{latest}
					</span>
				) : null}
			</div>
			<div className="h-44">
				<ResponsiveContainer width="100%" height="100%">
					<AreaChart
						data={data}
						margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
						syncId="service-metrics"
					>
						<defs>
							{series.map((item) => (
								<SeriesGradient key={item.key} id={item.gradientId} color={item.color} />
							))}
						</defs>
						<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
						<XAxis
							dataKey="time"
							stroke="var(--muted-foreground)"
							fontSize={10}
							fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace"
							tickLine={false}
							axisLine={false}
							minTickGap={40}
						/>
						<YAxis
							stroke="var(--muted-foreground)"
							fontSize={10}
							fontFamily="var(--font-jetbrains-mono), ui-monospace, monospace"
							tickLine={false}
							axisLine={false}
							width={52}
							tickFormatter={(value: number) => formatValue(value)}
						/>
						<Tooltip
							contentStyle={tooltipStyle}
							labelStyle={{ color: "var(--muted-foreground)" }}
							formatter={(value, name) => [
								formatValue(typeof value === "number" ? value : Number(value)),
								String(name),
							]}
						/>
						{series.map((item) => (
							<Area
								key={item.key}
								type="monotone"
								dataKey={item.key}
								name={item.label}
								stroke={item.color}
								fill={`url(#${item.gradientId})`}
								strokeWidth={1.5}
								isAnimationActive={false}
							/>
						))}
						{annotations.map((annotation) => (
							<ReferenceLine
								key={annotation.id}
								x={annotation.x}
								stroke={annotation.color}
								strokeDasharray="2 3"
								strokeOpacity={0.85}
								// `insideTop`, not `top`: the chart leaves 4px of margin above
								// the plot area and a label placed there is clipped away.
								label={{
									value: annotation.mark,
									position: "insideTop",
									fill: annotation.color,
									fontSize: 11,
								}}
							/>
						))}
						{peaks.map(
							(peak) =>
								peak.value > 0 && (
									<ReferenceLine
										key={peak.key}
										y={peak.value}
										stroke={peak.color}
										strokeDasharray="4 4"
										strokeOpacity={0.4}
									/>
								),
						)}
					</AreaChart>
				</ResponsiveContainer>
			</div>
			<div className="flex items-center gap-4">
				{series.map((item) => (
					<span key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
						{item.label}
					</span>
				))}
			</div>
		</div>
	);
}

type Range = "live" | 1 | 6 | 24 | 48;

const RANGES: { value: Range; label: string }[] = [
	{ value: "live", label: "Live" },
	{ value: 1, label: "1h" },
	{ value: 6, label: "6h" },
	{ value: 24, label: "24h" },
	{ value: 48, label: "48h" },
];

export function MonitoringCharts({
	appName,
	serverId,
	serviceType,
	serviceId,
	serviceStatus,
	notRunningAction,
}: {
	appName: string;
	serverId?: string | null;
	/** Both or neither: without them the charts render without event markers. */
	serviceType?: ServiceKind;
	serviceId?: string;
} & RuntimeEmptyProps) {
	const trpc = useTRPC();
	const [range, setRange] = useState<Range>("live");
	const [liveSamples, setLiveSamples] = useState<Sample[]>([]);
	const [connected, setConnected] = useState(false);
	const [notRunningMessage, setNotRunningMessage] = useState<string | null>(null);
	const [retryNonce, setRetryNonce] = useState(0);
	const previousNetworkRef = useRef<{
		rx: number;
		tx: number;
		read: number;
		write: number;
		at: number;
	} | null>(null);

	const historyQuery = useQuery({
		...trpc.monitoring.history.queryOptions({
			appName,
			hours: range === "live" ? 1 : range,
		}),
		enabled: range !== "live",
		refetchInterval: 60_000,
	});

	// History rows are cumulative; network rates come from consecutive deltas.
	const historySamples = useMemo<Sample[]>(() => {
		const rows = historyQuery.data ?? [];
		return rows.map((row, index) => {
			const previous = index > 0 ? rows[index - 1] : undefined;
			const elapsedSeconds = previous ? Math.max((row.t - previous.t) / 1000, 1) : 30;
			return {
				at: new Date(row.t).getTime(),
				time: new Date(row.t).toLocaleTimeString("en-GB", { hour12: false }),
				cpu: row.cpu,
				memoryPercent: row.memoryTotal > 0 ? (row.memoryUsed / row.memoryTotal) * 100 : 0,
				memoryUsed: row.memoryUsed,
				rxRate: previous ? Math.max((row.rx - previous.rx) / elapsedSeconds, 0) : 0,
				txRate: previous ? Math.max((row.tx - previous.tx) / elapsedSeconds, 0) : 0,
				diskReadRate: previous
					? Math.max((row.blockRead - previous.blockRead) / elapsedSeconds, 0)
					: 0,
				diskWriteRate: previous
					? Math.max((row.blockWrite - previous.blockWrite) / elapsedSeconds, 0)
					: 0,
				pids: row.pids,
			};
		});
	}, [historyQuery.data]);

	const samples = range === "live" ? liveSamples : historySamples;

	// 24h uptime: sampled-30s slots with data vs the full window (history only —
	// services without samples yet show nothing).
	const uptimeQuery = useQuery({
		...trpc.monitoring.history.queryOptions({ appName, hours: 24 }),
		refetchInterval: 60_000,
	});
	const uptime = useMemo(() => {
		const rows = uptimeQuery.data ?? [];
		if (rows.length === 0) return null;
		const expectedSlots = (24 * 60 * 60) / 30;
		return Math.min(100, (rows.length / expectedSlots) * 100);
	}, [uptimeQuery.data]);

	/**
	 * Deploys, rollbacks and kills drawn on top of the metric lines — the whole
	 * point of the timeline is that a spike and its cause sit next to each other.
	 *
	 * The query key carries no time window on purpose: it would change every
	 * minute and mint a new cache entry each time. The newest events are fetched
	 * once, the socket's `service-event` frame refetches them, and the ones
	 * outside the plotted window are dropped when they fail to snap to a sample.
	 */
	const eventsQuery = useQuery({
		...trpc.observability.serviceEvents.queryOptions({
			serviceType: serviceType as ServiceKind,
			serviceId: serviceId as string,
			kinds: [...SERVICE_EVENT_CHART_KINDS],
			limit: 100,
		}),
		enabled: Boolean(serviceType && serviceId),
	});
	const annotations = useMemo(
		() => snapEventsToSamples(samples, eventsQuery.data?.events ?? []),
		[samples, eventsQuery.data],
	);

	// Per-replica breakdown (only rendered when the service has >1 container).
	const replicasQuery = useQuery({
		...trpc.monitoring.replicaStats.queryOptions({ appName, serverId }),
		refetchInterval: 30_000,
	});
	const replicas = replicasQuery.data ?? [];

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce is an intentional retrigger for the Retry button
	useEffect(() => {
		if (range !== "live") return;
		let ws: WebSocket | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let attempts = 0;
		let stopped = false;
		const finishedRef = { current: false };

		const connect = () => {
			setConnected(false);
			setNotRunningMessage(null);
			ws = new WebSocket(wsUrl({ appName, serverId }));

			ws.onopen = () => {
				attempts = 0;
				setConnected(true);
			};

			ws.onmessage = (event: MessageEvent<string>) => {
				if (typeof event.data !== "string") return;
				// Control frames: the server reports "no running container" as an
				// error frame — show an empty state instead of reconnecting forever.
				const maybeControl = JSON.parse(event.data) as { type?: string; message?: string };
				if (maybeControl?.type === "error") {
					finishedRef.current = true;
					setNotRunningMessage(maybeControl.message ?? "Service is not running");
					ws?.close();
					return;
				}
				const frame = maybeControl as unknown as StatsFrame;
				if (typeof frame.cpu !== "number" || !frame.memory || !frame.network) return;
				setNotRunningMessage(null);

				const now = Date.now();
				const previous = previousNetworkRef.current;
				const elapsedSeconds = previous ? Math.max((now - previous.at) / 1000, 0.1) : 1;
				const rxRate = previous
					? Math.max((frame.network.rx - previous.rx) / elapsedSeconds, 0)
					: 0;
				const txRate = previous
					? Math.max((frame.network.tx - previous.tx) / elapsedSeconds, 0)
					: 0;
				const block = frame.block ?? { read: 0, write: 0 };
				const diskReadRate = previous
					? Math.max((block.read - previous.read) / elapsedSeconds, 0)
					: 0;
				const diskWriteRate = previous
					? Math.max((block.write - previous.write) / elapsedSeconds, 0)
					: 0;
				previousNetworkRef.current = {
					rx: frame.network.rx,
					tx: frame.network.tx,
					read: block.read,
					write: block.write,
					at: now,
				};

				const sample: Sample = {
					at: now,
					time: new Date(now).toLocaleTimeString("en-GB", { hour12: false }),
					cpu: frame.cpu,
					memoryPercent: frame.memory.percent,
					memoryUsed: frame.memory.used,
					rxRate,
					txRate,
					diskReadRate,
					diskWriteRate,
					pids: frame.pids ?? 0,
				};
				setLiveSamples((existing) => {
					const next = [...existing, sample];
					return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
				});
			};

			ws.onclose = () => {
				setConnected(false);
				if (stopped || finishedRef.current) return;
				const delay = Math.min(1000 * 2 ** attempts++, 15_000);
				reconnectTimer = setTimeout(connect, delay);
			};
			ws.onerror = () => ws?.close();
		};

		setLiveSamples([]);
		previousNetworkRef.current = null;
		connect();

		return () => {
			stopped = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			ws?.close();
		};
	}, [appName, serverId, range, retryNonce]);

	const latest = samples[samples.length - 1];
	const peakCpu = samples.reduce((peak, sample) => Math.max(peak, sample.cpu), 0);
	const peakMemory = samples.reduce((peak, sample) => Math.max(peak, sample.memoryPercent), 0);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span
						className={cn(
							"size-1.5 rounded-full",
							range !== "live" ? "bg-info" : connected ? "animate-pulse bg-success" : "bg-warning",
						)}
					/>
					{range !== "live"
						? `Last ${range}h`
						: notRunningMessage
							? "Not running"
							: connected
								? "Live metrics"
								: "Reconnecting to metrics stream…"}
					<span className="font-mono">{appName}</span>
				</div>
				{uptime != null && (
					<span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
						{uptime.toFixed(1)}% up · 24h
					</span>
				)}
				<div className="ml-auto flex items-center gap-1">
					{RANGES.map((option) => (
						<button
							key={String(option.value)}
							type="button"
							onClick={() => setRange(option.value)}
							className={cn(
								"rounded-md px-2 py-1 text-xs transition-colors",
								range === option.value
									? "bg-secondary font-medium text-foreground"
									: "text-muted-foreground hover:bg-secondary/60",
							)}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>

			{/* Stat cards only once a sample exists — six "—" tiles say nothing. */}
			{latest && (
				<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
					<KpiCard
						icon={Cpu}
						label="CPU"
						value={latest ? `${latest.cpu.toFixed(1)}%` : "—"}
						sub={samples.length > 1 ? `peak ${peakCpu.toFixed(0)}%` : undefined}
						color={METRICS.cpu}
						samples={samples}
						dataKey="cpu"
						gradientId="spark-cpu"
						meter={latest?.cpu}
					/>
					<KpiCard
						icon={HardDrive}
						label="Memory"
						value={latest ? formatBytes(latest.memoryUsed) : "—"}
						sub={
							latest
								? `${latest.memoryPercent.toFixed(1)}% · peak ${peakMemory.toFixed(0)}%`
								: undefined
						}
						color={METRICS.memory}
						samples={samples}
						dataKey="memoryPercent"
						gradientId="spark-mem"
						meter={latest?.memoryPercent}
					/>
					<KpiCard
						icon={ArrowDown}
						label="Network in"
						value={latest ? `${formatBytes(latest.rxRate)}/s` : "—"}
						color={METRICS.rx}
						samples={samples}
						dataKey="rxRate"
						gradientId="spark-rx"
					/>
					<KpiCard
						icon={ArrowUp}
						label="Network out"
						value={latest ? `${formatBytes(latest.txRate)}/s` : "—"}
						color={METRICS.tx}
						samples={samples}
						dataKey="txRate"
						gradientId="spark-tx"
					/>
					<KpiCard
						icon={Database}
						label="Disk I/O"
						value={latest ? `${formatBytes(latest.diskWriteRate)}/s` : "—"}
						sub={latest ? `read ${formatBytes(latest.diskReadRate)}/s` : undefined}
						color={METRICS.disk}
						samples={samples}
						dataKey="diskWriteRate"
						gradientId="spark-disk"
					/>
					<KpiCard
						icon={ListOrdered}
						label="Processes"
						value={latest ? String(latest.pids) : "—"}
						color={METRICS.pids}
						samples={samples}
						dataKey="pids"
						gradientId="spark-pids"
					/>
				</div>
			)}

			{replicas.length > 1 && (
				<SettingsSection title={`Replicas · ${replicas.length}`}>
					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{replicas.map((replica) => (
							<div
								key={replica.id}
								className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
							>
								<div className="flex items-center gap-2">
									<span
										className={cn(
											"size-1.5 rounded-full",
											replica.state === "running" ? "bg-success" : "bg-warning",
										)}
									/>
									<span className="max-w-40 truncate font-mono text-xs">{replica.name}</span>
								</div>
								<span className="text-xs text-muted-foreground tabular-nums">
									{replica.cpu.toFixed(1)}% · {formatBytes(replica.memoryUsed)} · {replica.pids}{" "}
									pids
								</span>
							</div>
						))}
					</div>
				</SettingsSection>
			)}

			{notRunningMessage && range === "live" ? (
				<NotRunningState
					action={notRunningAction}
					onRetry={
						serviceStatus === "idle"
							? undefined
							: () => {
									setNotRunningMessage(null);
									setRetryNonce((value) => value + 1);
								}
					}
				/>
			) : ((range === "live" && !connected) || (range !== "live" && historyQuery.isLoading)) &&
				samples.length === 0 ? (
				<div className="flex h-40 items-center justify-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
					<Activity className="size-4 animate-pulse" />
					{range === "live" ? "Connecting to metrics stream…" : "Loading metrics history…"}
				</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-2">
					<MetricChart
						title="CPU usage"
						latest={latest ? `${latest.cpu.toFixed(1)}%` : undefined}
						data={samples}
						series={[{ key: "cpu", label: "CPU", color: METRICS.cpu, gradientId: "chart-cpu" }]}
						formatValue={(value) => `${value.toFixed(0)}%`}
						annotations={annotations}
					/>
					<MetricChart
						title="Memory usage"
						latest={latest ? `${latest.memoryPercent.toFixed(1)}%` : undefined}
						data={samples}
						series={[
							{
								key: "memoryPercent",
								label: "Memory",
								color: METRICS.memory,
								gradientId: "chart-mem",
							},
						]}
						formatValue={(value) => `${value.toFixed(0)}%`}
						annotations={annotations}
					/>
					<div className="lg:col-span-2">
						<MetricChart
							title="Network"
							latest={
								latest
									? `↓ ${formatBytes(latest.rxRate)}/s · ↑ ${formatBytes(latest.txRate)}/s`
									: undefined
							}
							data={samples}
							series={[
								{ key: "rxRate", label: "Received", color: METRICS.rx, gradientId: "chart-rx" },
								{ key: "txRate", label: "Sent", color: METRICS.tx, gradientId: "chart-tx" },
							]}
							formatValue={(value) => `${formatBytes(value)}/s`}
							annotations={annotations}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
