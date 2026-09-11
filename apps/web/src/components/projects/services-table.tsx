"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Play, Square } from "lucide-react";
import Link from "next/link";
import { type ComponentProps, Fragment, useState } from "react";
import { toast } from "sonner";

import { capabilityHint } from "@/components/services/capability-hint";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { useRunningDeployments } from "@/hooks/use-running-deployments";
import { toastError } from "@/lib/describe-error";
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

	const groups = TYPE_ORDER.map((type) => ({
		type,
		meta: SERVICE_TYPE_META[type],
		items: services.filter((service) => service.type === type),
	})).filter((group) => group.items.length > 0);

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

			<TableCard>
				<Table>
					<TableBody>
						{groups.map((group) => (
							<Fragment key={group.type}>
								<TableRow className="bg-secondary/60 hover:bg-secondary/60">
									<TableCell
										colSpan={5}
										className="py-1.5 text-xs font-medium text-muted-foreground"
									>
										{group.meta.label}
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
											<TableCell>
												<div className="flex flex-col gap-1">
													<Link
														href={href}
														className="text-sm font-medium after:absolute after:inset-0 hover:underline"
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
											<TableCell className="max-w-64 truncate text-sm text-muted-foreground">
												{service.description || "—"}
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
