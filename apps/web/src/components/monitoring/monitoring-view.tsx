"use client";

import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	ChevronsUpDown,
	Cpu,
	HardDrive,
	MemoryStick,
	Search,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { SettingsSection } from "@/components/layout/settings-section";
import { PrometheusCard } from "@/components/monitoring/prometheus-card";
import { QueryState } from "@/components/query-state";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { RuntimeLogHistory } from "@/components/services/runtime-log-history";
import { ServiceStatusBadge } from "@/components/services/status-badge";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useMounted } from "@/hooks/use-mounted";
import { useSyncedTab } from "@/hooks/use-synced-tab";
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
				<span className="text-[11px] font-medium normal-case tracking-wide">{label}</span>
			</div>
			<p className="truncate text-sm font-semibold tabular-nums">{value}</p>
			{percent != null ? (
				<Progress
					value={Math.min(100, Math.max(0, percent))}
					aria-label={`${label} usage`}
					className="h-1"
				/>
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
								alert.severity === "critical" ? "bg-destructive" : "bg-warning",
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
	const [view, selectView] = useSyncedTab(
		"metrics",
		(value) => ["metrics", "alerts", "logs", "configuration"].includes(value),
		{ param: "view" },
	);
	const trpc = useTRPC();
	const [search, setSearch] = useState("");
	const [pickerOpen, setPickerOpen] = useState(false);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const { isInstanceAdmin } = useCapabilities();
	// The session role is only known client-side; wait for mount so SSR and
	// the first client paint agree on whether the host block exists.
	const mounted = useMounted();
	// Host metrics without a serverId read the Nixploy host — instance admin only.
	const showHost = mounted && isInstanceAdmin;
	const activeView = view === "alerts" && !showHost ? "metrics" : view;

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
	const needle = search.trim().toLowerCase();
	const matchingFleet = fleet.filter((row) =>
		[row.name, row.kind, row.projectName, row.environmentName].some((value) =>
			value.toLowerCase().includes(needle),
		),
	);

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

			<Tabs value={activeView} onValueChange={selectView} activationMode="manual">
				<SubTabsList aria-label="Monitoring views">
					<SubTabsTrigger value="metrics">Live metrics</SubTabsTrigger>
					{showHost ? <SubTabsTrigger value="alerts">Platform alerts</SubTabsTrigger> : null}
					<SubTabsTrigger value="logs">Log history</SubTabsTrigger>
					<SubTabsTrigger value="configuration">Prometheus</SubTabsTrigger>
				</SubTabsList>
				<TabsContent value="metrics">
					<div className="grid items-start gap-6 xl:grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)]">
						<div className="xl:hidden">
							<Popover open={pickerOpen} onOpenChange={setPickerOpen}>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										role="combobox"
										aria-expanded={pickerOpen}
										aria-label="Choose monitored service"
										className="h-auto min-h-11 w-full justify-between py-3 text-start"
									>
										<span className="min-w-0 break-words">
											{fleetQuery.isError
												? "Could not load services"
												: (selected?.name ?? "Choose a service")}
										</span>
										<ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
									</Button>
								</PopoverTrigger>
								<PopoverContent
									className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] p-0"
									align="start"
								>
									<QueryState
										isPending={fleetQuery.isPending}
										isError={fleetQuery.isError}
										error={fleetQuery.error}
										onRetry={() => fleetQuery.refetch()}
										isEmpty={false}
										empty={null}
										skeleton={<Skeleton className="m-3 h-11" />}
									>
										<Command>
											<CommandInput
												placeholder="Service, project or environment…"
												aria-label="Search monitored services"
											/>
											<CommandList>
												<CommandEmpty>
													{fleet.length ? "No services match." : "No services yet."}
												</CommandEmpty>
												<CommandGroup>
													{fleet.map((row) => {
														const key = `${row.kind}:${row.serviceId}`;
														return (
															<CommandItem
																key={key}
																value={key}
																keywords={[
																	row.name,
																	row.kind,
																	row.projectName,
																	row.environmentName,
																]}
																onSelect={() => {
																	setSelectedKey(key);
																	setPickerOpen(false);
																}}
																className="items-start gap-3 py-3"
															>
																<Check
																	className={cn(
																		"mt-0.5 size-4 shrink-0",
																		key !== selectedKey && "opacity-0",
																	)}
																	aria-hidden
																/>
																<span className="min-w-0">
																	<span className="block break-words text-sm">{row.name}</span>
																	<span className="mt-1 block break-words text-xs text-muted-foreground">
																		{row.projectName} / {row.environmentName} · {row.kind}
																	</span>
																</span>
															</CommandItem>
														);
													})}
												</CommandGroup>
											</CommandList>
										</Command>
									</QueryState>
								</PopoverContent>
							</Popover>
						</div>
						<aside
							aria-label="Service inventory"
							className="hidden min-w-0 overflow-hidden rounded-xl border bg-card xl:block"
						>
							<div className="border-b border-border px-3 py-2.5">
								<p className="text-sm font-medium">Services</p>
								<p className="text-xs text-muted-foreground">
									{fleetQuery.isPending
										? "Loading…"
										: `${fleet.length} service${fleet.length === 1 ? "" : "s"}`}
								</p>
							</div>
							<div className="relative m-3">
								<Search
									aria-hidden="true"
									className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									type="search"
									aria-label="Search monitored services"
									placeholder="Service, project or environment…"
									className="pl-9"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
								/>
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
									{matchingFleet.map((row) => {
										const key = `${row.kind}:${row.serviceId}`;
										const active = key === selectedKey;
										return (
											<li key={key}>
												<Button
													variant="ghost"
													size="sm"
													type="button"
													onClick={() => setSelectedKey(key)}
													aria-pressed={active}
													className={cn(
														"flex w-full flex-col items-stretch justify-start rounded-none font-normal gap-1 px-3 py-2.5 text-left transition-colors",
														active ? "bg-secondary" : "hover:bg-secondary/50",
													)}
												>
													<div className="flex items-start justify-between gap-2">
														<span className="truncate text-sm font-medium">{row.name}</span>
														<ServiceStatusBadge status={row.status} />
													</div>
													<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
														<span className="truncate">
															{row.kind} · {row.projectName}/{row.environmentName}
														</span>
														<span className="shrink-0 tabular-nums">
															{row.metrics
																? `CPU ${row.metrics.cpu.toFixed(0)}% · RAM ${row.metrics.memoryPercent.toFixed(0)}%`
																: "Metrics unavailable"}
														</span>
													</div>
												</Button>
											</li>
										);
									})}
								</ul>
								{matchingFleet.length === 0 && fleet.length > 0 && (
									<div className="px-4 py-8 text-center text-sm">
										<p className="text-muted-foreground">No services match “{search}”.</p>
										<Button variant="ghost" size="sm" onClick={() => setSearch("")}>
											Clear search
										</Button>
									</div>
								)}
							</QueryState>
						</aside>

						<section
							aria-label="Selected service metrics"
							className="min-w-0 overflow-hidden rounded-xl border bg-card"
						>
							{selected ? (
								<>
									<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
										<div className="min-w-0">
											<p className="truncate text-sm font-medium">{selected.name}</p>
											<p className="truncate font-mono text-xs text-muted-foreground">
												{selected.kind} · {selected.appName}
											</p>
										</div>
										<Button asChild size="sm" variant="outline">
											<Link href={`${serviceHref(selected)}?tab=monitoring`}>Open service</Link>
										</Button>
									</div>
									<div className="p-4">
										<MonitoringCharts
											appName={selected.appName}
											serverId={selected.serverId}
											serviceType={selected.kind}
											serviceId={selected.serviceId}
										/>
									</div>
								</>
							) : (
								<p className="px-4 py-16 text-center text-sm text-muted-foreground">
									{fleetQuery.isPending ? "Loading services…" : "Select a service to view charts."}
								</p>
							)}
						</section>
					</div>
				</TabsContent>
				{showHost ? (
					<TabsContent value="alerts">
						<PlatformAlertsCard />
					</TabsContent>
				) : null}
				<TabsContent value="logs">
					{/* Setup detail, not a thing to watch — it sat above the fleet and
			    pushed the service list and its charts below the fold. */}
					<SettingsSection
						bare
						title="Logs"
						description="Runtime log history across every service you can see — what containers printed, kept by the worker past their lifetime."
					>
						<RuntimeLogHistory />
					</SettingsSection>
				</TabsContent>
				<TabsContent value="configuration">
					<PrometheusCard />
				</TabsContent>
			</Tabs>
		</div>
	);
}
