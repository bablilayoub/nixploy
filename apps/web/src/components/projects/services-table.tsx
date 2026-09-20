"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Play, Square } from "lucide-react";
import Link from "next/link";
import { type ComponentProps, Fragment, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { capabilityHint } from "@/components/services/capability-hint";
import { ServiceUrl } from "@/components/services/service-url";
import { ServiceStatusBadge } from "@/components/services/status-badge";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import {
	TableFacet,
	TableFilterReset,
	TableNoMatch,
	TablePagination,
	TableSearch,
} from "@/components/ui/table-toolbar";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useRunningDeployments } from "@/hooks/use-running-deployments";
import { useTableView } from "@/hooks/use-table-view";
import { toastError } from "@/lib/describe-error";
import type { DomainLike } from "@/lib/service-url";
import { useTRPC, useTRPCClient } from "@/lib/trpc";

import { ServiceRowActions } from "./service-row-actions";
import {
	ID_FIELD,
	SERVICE_TYPE_META,
	type ServiceType,
	serviceRouterClient,
} from "./service-types";

export interface ServiceEntry {
	type: ServiceType;
	id: string;
	name: string;
	description?: string | null;
	status: string;
	tags?: Array<{ tagId: string; name: string; color: string }>;
	/** Primary HTTP domain, when the service has one (applications and compose). */
	domain?: DomainLike | null;
}

const TYPE_ORDER = Object.keys(SERVICE_TYPE_META) as ServiceType[];

const serviceKey = (service: ServiceEntry) => `${service.type}:${service.id}`;

type BadgeStatus = ComponentProps<typeof ServiceStatusBadge>["status"];

/**
 * Services table — one hairline row per service, grouped by service type.
 * Rows are selectable for bulk start/stop; each row has its own menu.
 */
export function ServicesTable({
	projectId,
	environmentName,
	services,
	currentEnvironmentId,
}: {
	projectId: string;
	environmentName: string;
	services: ServiceEntry[];
	currentEnvironmentId?: string;
}) {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkPending, setBulkPending] = useState(false);
	const [confirmStop, setConfirmStop] = useState(false);

	// Live deploy state per row (UX audit F13). The shared query also refreshes
	// `<type>.all` / environment counts when a deployment settles, so the
	// status badges here stop going stale after a deploy.
	const { active: activeDeployments } = useRunningDeployments({ projectId });
	const deployingBadge = (service: ServiceEntry) => {
		if (service.type !== "application" && service.type !== "compose") return null;
		const deployment = activeDeployments.find((row) =>
			service.type === "application"
				? row.applicationId === service.id
				: row.composeId === service.id,
		);
		if (!deployment) return null;
		return (
			<Badge variant="info" className="gap-1.5 font-normal">
				<Loader2 className="size-3 animate-spin" />
				{deployment.status === "queued"
					? `Queued${deployment.queuePosition ? ` (#${deployment.queuePosition})` : ""}`
					: "Deploying"}
			</Badge>
		);
	};

	// Bulk start/stop hit the runtime procedures (database `start` additionally
	// requires service.deploy; the server still reports those per row).
	const canRuntime = can("service.runtime");
	const runtimeHint = canRuntime ? undefined : capabilityHint("service.runtime");

	// An environment holds anything from three services to a hundred; the list
	// is the same shape either way, so the chrome appears with the rows (the
	// search box from eight, the pager from one page) rather than being
	// designed for whichever size was in front of us.
	const [types, setTypes] = useState<string[]>([]);
	const [statuses, setStatuses] = useState<string[]>([]);
	const rows = useMemo(
		() =>
			[...services].sort(
				(a, b) =>
					TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name),
			),
		[services],
	);
	const filter = useCallback(
		(service: ServiceEntry) =>
			(types.length === 0 || types.includes(service.type)) &&
			(statuses.length === 0 || statuses.includes(service.status)),
		[types, statuses],
	);
	const view = useTableView({
		rows,
		filter,
		filterKey: `${types.join(",")}|${statuses.join(",")}`,
		search: (service) => [
			service.name,
			service.description,
			service.domain?.host,
			...(service.tags ?? []).map((tag) => tag.name),
		],
	});

	/** Facet options, counted over the rows the other facet leaves. */
	const facetCount = (predicate: (service: ServiceEntry) => boolean, ignore: "type" | "status") =>
		services.filter(
			(service) =>
				predicate(service) &&
				(ignore === "type" || types.length === 0 || types.includes(service.type)) &&
				(ignore === "status" || statuses.length === 0 || statuses.includes(service.status)),
		).length;
	const typeOptions = TYPE_ORDER.filter((type) =>
		services.some((service) => service.type === type),
	).map((type) => ({
		value: type,
		label: SERVICE_TYPE_META[type].label,
		count: facetCount((service) => service.type === type, "type"),
	}));
	const statusOptions = [...new Set(services.map((service) => service.status))]
		.sort((a, b) => a.localeCompare(b))
		.map((status) => ({
			value: status,
			label: status.charAt(0).toUpperCase() + status.slice(1),
			count: facetCount((service) => service.status === status, "status"),
		}));

	// The page is what gets grouped: a run of one type inside the rows on
	// screen, which is what the sort already produced.
	const groups: Array<{ type: ServiceType; items: ServiceEntry[] }> = [];
	for (const service of view.visible) {
		const last = groups.at(-1);
		if (last?.type === service.type) last.items.push(service);
		else groups.push({ type: service.type, items: [service] });
	}

	const toggle = (service: ServiceEntry, checked: boolean) => {
		setSelected((previous) => {
			const next = new Set(previous);
			if (checked) next.add(serviceKey(service));
			else next.delete(serviceKey(service));
			return next;
		});
	};

	const selectedServices = services.filter((service) => selected.has(serviceKey(service)));

	/** Refresh only the lists the action touched: each affected `<type>.all` plus the environment counts. */
	const invalidateAffected = async (types: Iterable<ServiceType>) => {
		const serviceInput = { projectId, environmentName };
		await Promise.all([
			...[...new Set(types)].map((type) =>
				queryClient.invalidateQueries({ queryKey: trpc[type].all.queryKey(serviceInput) }),
			),
			queryClient.invalidateQueries({
				queryKey: trpc.environment.byProject.queryKey({ projectId }),
			}),
		]);
	};

	const runBulk = async (action: "start" | "stop") => {
		setBulkPending(true);
		const targets = selectedServices;
		let failed = 0;
		try {
			for (const service of targets) {
				try {
					await serviceRouterClient(trpcClient, service.type)[action].mutate({
						[ID_FIELD[service.type]]: service.id,
					});
				} catch {
					failed += 1;
				}
			}
			if (failed > 0) {
				toast.error(`${failed} service${failed === 1 ? "" : "s"} failed to ${action}`);
			} else {
				toast.success(
					`${targets.length} service${targets.length === 1 ? "" : "s"} ${action === "start" ? "started" : "stopped"}`,
				);
			}
			await invalidateAffected(targets.map((service) => service.type));
		} catch (error) {
			toastError(error, "Failed to refresh services");
		} finally {
			setBulkPending(false);
			setSelected(new Set());
			setConfirmStop(false);
		}
	};

	return (
		<div className="space-y-3">
			<AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Stop {selectedServices.length} service{selectedServices.length === 1 ? "" : "s"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							Stop the {selectedServices.length} selected service
							{selectedServices.length === 1 ? "" : "s"}? They will go offline until you start them
							again.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={bulkPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={bulkPending}
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until every stop settled.
								event.preventDefault();
								void runBulk("stop");
							}}
						>
							{bulkPending && <Loader2 className="size-4 animate-spin" />}
							Stop
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{selected.size > 0 && (
				<div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2">
					<span className="text-sm text-muted-foreground">{selected.size} selected</span>
					<div className="flex items-center gap-2">
						<DisabledHint hint={runtimeHint}>
							<Button
								size="sm"
								variant="outline"
								disabled={bulkPending || !canRuntime}
								onClick={() => void runBulk("start")}
							>
								{bulkPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Play className="size-4" />
								)}
								Start
							</Button>
						</DisabledHint>
						<DisabledHint hint={runtimeHint}>
							<Button
								size="sm"
								variant="outline"
								disabled={bulkPending || !canRuntime}
								onClick={() => setConfirmStop(true)}
							>
								<Square className="size-4" />
								Stop
							</Button>
						</DisabledHint>
						<Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
							Clear
						</Button>
					</div>
				</div>
			)}

			<TableCard
				toolbar={
					<>
						<TableSearch view={view} placeholder="Search services…" />
						<TableFacet label="Type" options={typeOptions} selected={types} onChange={setTypes} />
						<TableFacet
							label="Status"
							options={statusOptions}
							selected={statuses}
							onChange={setStatuses}
						/>
						<TableFilterReset
							show={types.length > 0 || statuses.length > 0 || view.query.length > 0}
							onClear={() => {
								setTypes([]);
								setStatuses([]);
								view.clear();
							}}
						/>
					</>
				}
				footer={<TablePagination view={view} noun="services" />}
			>
				<Table>
					<TableBody>
						<TableNoMatch
							view={view}
							colSpan={5}
							onClear={() => {
								setTypes([]);
								setStatuses([]);
								view.clear();
							}}
						/>
						{groups.map((group) => (
							<Fragment key={group.type}>
								<TableRow className="bg-secondary/60 hover:bg-secondary/60">
									<TableCell
										colSpan={5}
										className="py-1.5 text-xs font-medium text-muted-foreground"
									>
										{SERVICE_TYPE_META[group.type].label}
									</TableCell>
								</TableRow>
								{group.items.map((service) => {
									const href = `/dashboard/projects/${projectId}/services/${service.type}/${service.id}`;
									const key = serviceKey(service);
									return (
										<TableRow key={key} className="relative">
											<TableCell className="w-8">
												<Checkbox
													checked={selected.has(key)}
													onCheckedChange={(checked) => toggle(service, checked === true)}
													aria-label={`Select ${service.name}`}
													className="relative z-10"
												/>
											</TableCell>
											<TableCell className="w-36">
												{/* Same vocabulary as the service headers; only the header dot pulses, not every row. */}
												<span className="[&_.animate-pulse]:animate-none">
													{deployingBadge(service) ?? (
														<ServiceStatusBadge status={service.status as BadgeStatus} />
													)}
												</span>
											</TableCell>
											<TableCell className="max-w-64">
												<div className="flex min-w-0 flex-col gap-1">
													<Link
														href={href}
														className="truncate text-sm font-medium after:absolute after:inset-0 hover:underline"
														title={service.name}
													>
														{service.name}
													</Link>
													{(service.tags?.length ?? 0) > 0 && (
														<div className="relative z-10 flex flex-wrap gap-1">
															{service.tags?.map((tag) => (
																<span
																	key={tag.tagId}
																	className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
																	style={{
																		backgroundColor: `${tag.color}22`,
																		color: tag.color,
																	}}
																>
																	{tag.name}
																</span>
															))}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell className="max-w-72 text-sm text-muted-foreground">
												{service.domain ? (
													<span className="relative z-10 flex min-w-0">
														<ServiceUrl domain={service.domain} compact />
													</span>
												) : (
													<span className="block truncate">{service.description || "—"}</span>
												)}
											</TableCell>
											<TableCell className="w-20 text-right">
												<div className="flex items-center justify-end gap-1">
													<ServiceRowActions
														service={service}
														projectId={projectId}
														environmentName={environmentName}
														currentEnvironmentId={currentEnvironmentId}
													/>
													<Link
														href={href}
														aria-label={`Open ${service.name}`}
														className="relative z-10 inline-flex"
													>
														<ChevronRight className="size-4 text-muted-foreground" />
													</Link>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</Fragment>
						))}
					</TableBody>
				</Table>
			</TableCard>
		</div>
	);
}
