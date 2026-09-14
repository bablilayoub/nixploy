"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Cpu, HardDrive, MemoryStick, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PrometheusCard } from "@/components/monitoring/prometheus-card";
import { QueryState } from "@/components/query-state";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { ServiceStatusBadge } from "@/components/services/status-badge";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useMounted } from "@/hooks/use-mounted";
import { formatBytes } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function HostStat({
	icon: Icon,
	label,
	value,
	percent,
	hint,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string;
	percent?: number | null;
	hint?: string;
}) {
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3 sm:border-r sm:border-border sm:last:border-r-0">
			<div className="flex items-center gap-1.5 text-muted-foreground">
				<Icon className="size-3.5 shrink-0" />
				<span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
			</div>
			<p className="truncate text-sm font-semibold tabular-nums">{value}</p>
			{percent != null ? (
				<div className="h-1 overflow-hidden rounded-full bg-muted">
					<div
						className={cn(
							"h-full rounded-full transition-[width] duration-500",
							percent >= 90 ? "bg-destructive" : "bg-foreground/80",
						)}
						style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
					/>
				</div>
			) : (
				<div className="h-1" />
			)}
			{hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

interface PlatformAlertRow {
	kind: string;
	severity: string;
	summary: string;
}

/** Mirrors `platformAlertLabel` in `modules/notifications/platform.ts`. */
const PLATFORM_ALERT_LABELS: Record<string, string> = {
	hostDisk: "Disk usage",
	queueStalled: "Deploy queue stalled",
	certExpiry: "Certificate expiring",
	platformService: "Platform service degraded",
	instanceBackup: "Instance backup missing",
};

/**
 * Platform self-alerts (disk, deploy queue age, certificate expiry, platform
 * services, instance backups). The 5-minute cron
 * (`modules/monitoring/platform-alerts.ts`) persists the state and
 * `GET /api/ready` reports it, so this card reads the readiness endpoint
 * directly instead of adding a router procedure that would run the probes a
 * second time. Instance admins only — it is about the host, not the org.
 */
function PlatformAlertsCard() {
	const query = useQuery({
		queryKey: ["platform-alerts"],
		refetchInterval: 60_000,
		queryFn: async (): Promise<{ evaluatedAt: string | null; alerts: PlatformAlertRow[] }> => {
			// /api/ready answers 503 while a check fails; the body is still the report.
			const response = await fetch("/api/ready", { cache: "no-store" });
			const report = (await response.json()) as {
				checks?: { platform?: { evaluatedAt?: string | null; alerts?: PlatformAlertRow[] } };
			};
			return {
				evaluatedAt: report.checks?.platform?.evaluatedAt ?? null,
				alerts: report.checks?.platform?.alerts ?? [],
			};
		},
	});

	// Nothing to say while it loads, when the cron has not run yet, or when the
	// platform is healthy — this card exists to be empty.
	if (query.isPending || query.isError) return null;
	const alerts = query.data?.alerts ?? [];
	if (alerts.length === 0) {
		if (!query.data?.evaluatedAt) return null;
		return (
			<div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3">
				<ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">
					No platform alerts — disk, deploy queue, certificates, platform services and instance
					backups are healthy.
				</p>
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-xl border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
				<AlertTriangle className="size-4 shrink-0 text-destructive" />
				<p className="text-sm font-medium">Platform alerts</p>
				<span className="text-xs text-muted-foreground">{alerts.length} active</span>
			</div>
			<ul className="divide-y">
				{alerts.map((alert) => (
					<li key={`${alert.kind}:${alert.severity}`} className="flex gap-3 px-4 py-2.5">
						<span
							className={cn(
								"mt-1 size-2 shrink-0 rounded-full",
								alert.severity === "critical" ? "bg-destructive" : "bg-amber-500",
							)}
						/>
						<div className="min-w-0">
							<p className="text-sm font-medium">
								{PLATFORM_ALERT_LABELS[alert.kind] ?? alert.kind}
							</p>
							<p className="text-xs text-muted-foreground">{alert.summary}</p>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

function serviceHref(row: { kind: string; serviceId: string; projectId: string }): string {
	const base = `/dashboard/projects/${row.projectId}/services`;
	if (row.kind === "application") return `${base}/application/${row.serviceId}`;
	if (row.kind === "compose") return `${base}/compose/${row.serviceId}`;
	return `${base}/${row.kind}/${row.serviceId}`;
}

/**
 * Fleet overview — host health plus live per-service charts. Rendered as the
 * Monitoring page's "Fleet" tab (UX audit F11); `embedded` drops the page
 * title that tab already carries.
 */
export function MonitoringView({ embedded = false }: { embedded?: boolean } = {}) {
	const trpc = useTRPC();
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const { isInstanceAdmin } = useCapabilities();
	// The session role is only known client-side; wait for mount so SSR and
	// the first client paint agree on whether the host block exists.
	const mounted = useMounted();
	// Host metrics without a serverId read the Nixploy host — instance admin only.
	const showHost = mounted && isInstanceAdmin;

	const hostQuery = useQuery({
		...trpc.monitoring.serverStats.queryOptions({}),
		refetchInterval: 30_000,
		enabled: showHost,
	});
	const fleetQuery = useQuery({
		...trpc.monitoring.fleetOverview.queryOptions(),
		refetchInterval: 30_000,
	});

	const fleet = fleetQuery.data ?? [];

	useEffect(() => {
		if (fleet.length === 0) return;
		const stillValid =
			selectedKey && fleet.some((row) => `${row.kind}:${row.serviceId}` === selectedKey);
		if (!stillValid) {
			const first = fleet[0];
			if (first) setSelectedKey(`${first.kind}:${first.serviceId}`);
		}
	}, [fleet, selectedKey]);

	const selected = useMemo(
		() => fleet.find((row) => `${row.kind}:${row.serviceId}` === selectedKey) ?? null,
		[fleet, selectedKey],
	);

	const memoryPercent = hostQuery.data?.memory.totalBytes
		? (hostQuery.data.memory.usedBytes / hostQuery.data.memory.totalBytes) * 100
		: null;
	const diskPercent = hostQuery.data?.disk.totalBytes
		? (hostQuery.data.disk.usedBytes / hostQuery.data.disk.totalBytes) * 100
		: null;
	const host = hostQuery.data;

	return (
		<div className="flex flex-col gap-5">
			{embedded ? null : (
				<PageHeader
					title="Monitoring"
					description={
						showHost
							? "Host health and live metrics across every service in this organization."
							: "Live metrics across every service in this organization."
					}
				/>
			)}

			{!mounted ? (
				<Skeleton className="h-[4.5rem] w-full rounded-lg" />
			) : showHost ? (
				<QueryState
					isPending={hostQuery.isPending}
					isError={hostQuery.isError}
					error={hostQuery.error}
					onRetry={() => hostQuery.refetch()}
					skeleton={<Skeleton className="h-[4.5rem] w-full rounded-lg" />}
					isEmpty={!host}
					empty={
						<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-6 text-center">
							<p className="text-sm text-muted-foreground">Unable to read host metrics</p>
						</div>
					}
				>
					{host ? (
						<div className="flex flex-col overflow-hidden rounded-xl border bg-card sm:flex-row">
							<HostStat
								icon={MemoryStick}
								label="Memory"
								value={`${formatBytes(host.memory.usedBytes)} / ${formatBytes(host.memory.totalBytes)}`}
								percent={memoryPercent}
								hint={memoryPercent != null ? `${memoryPercent.toFixed(0)}% used` : undefined}
							/>
							<HostStat
								icon={HardDrive}
								label="Disk"
								value={
									host.disk.totalBytes
										? `${formatBytes(host.disk.usedBytes)} / ${formatBytes(host.disk.totalBytes)}`
										: "Unavailable"
								}
								percent={diskPercent}
								hint={
									diskPercent != null
										? `${diskPercent.toFixed(0)}% used`
										: host.disk.usedPercent || undefined
								}
							/>
							<HostStat
								icon={Cpu}
								label="Load"
								value={host.loadAverage.map((v) => v.toFixed(2)).join(" · ")}
								percent={null}
								hint={`${host.containersRunning}/${host.containers} containers · ${host.cpus} CPUs`}
							/>
						</div>
					) : null}
				</QueryState>
			) : null}

			{showHost ? <PlatformAlertsCard /> : null}

			<div className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)]">
				<aside className="rounded-lg border">
					<div className="border-b border-border px-3 py-2.5">
						<p className="text-sm font-medium">Services</p>
						<p className="text-xs text-muted-foreground">
							{fleetQuery.isPending
								? "Loading…"
								: `${fleet.length} service${fleet.length === 1 ? "" : "s"}`}
						</p>
					</div>
					<QueryState
						isPending={fleetQuery.isPending}
						isError={fleetQuery.isError}
						error={fleetQuery.error}
						onRetry={() => fleetQuery.refetch()}
						isEmpty={fleet.length === 0}
						empty={
							<p className="px-3 py-8 text-center text-sm text-muted-foreground">
								No services yet. Deploy something to see metrics.
							</p>
						}
						skeleton={
							<div className="flex flex-col gap-2 p-3">
								<Skeleton className="h-12 w-full" />
								<Skeleton className="h-12 w-full" />
							</div>
						}
					>
						<ul className="max-h-[min(28rem,60vh)] divide-y overflow-y-auto">
							{fleet.map((row) => {
								const key = `${row.kind}:${row.serviceId}`;
								const active = key === selectedKey;
								return (
									<li key={key}>
										<button
											type="button"
											onClick={() => setSelectedKey(key)}
											className={cn(
												"flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors",
												active ? "bg-secondary" : "hover:bg-secondary/50",
											)}
										>
											<div className="flex items-start justify-between gap-2">
												<span className="truncate text-sm font-medium">{row.name}</span>
												<ServiceStatusBadge status={row.status} />
											</div>
											<div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
												<span className="truncate">
													{row.kind} · {row.projectName}/{row.environmentName}
												</span>
												<span className="shrink-0 tabular-nums">
													{row.metrics
														? `${row.metrics.cpu.toFixed(0)}% · ${row.metrics.memoryPercent.toFixed(0)}%`
														: "—"}
												</span>
											</div>
										</button>
									</li>
								);
							})}
						</ul>
					</QueryState>
				</aside>

				<section className="min-w-0 rounded-lg border">
					{selected ? (
						<>
							<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">{selected.name}</p>
									<p className="truncate font-mono text-xs text-muted-foreground">
										{selected.kind} · {selected.appName}
									</p>
								</div>
								<Button asChild size="sm" variant="outline">
									<Link href={`${serviceHref(selected)}?tab=monitoring`}>Open</Link>
								</Button>
							</div>
							<div className="p-4">
								<MonitoringCharts appName={selected.appName} serverId={selected.serverId} />
							</div>
						</>
					) : (
						<p className="px-4 py-16 text-center text-sm text-muted-foreground">
							{fleetQuery.isPending ? "Loading services…" : "Select a service to view charts."}
						</p>
					)}
				</section>
			</div>

			{/* Setup detail, not a thing to watch — it sat above the fleet and
			    pushed the service list and its charts below the fold. */}
			<PrometheusCard />
		</div>
	);
}
