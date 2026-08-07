"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Play, Square } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useTRPCClient } from "@/lib/trpc";

import { ServiceRowActions } from "./service-row-actions";
import { SERVICE_TYPE_META, type ServiceType } from "./service-types";

export interface ServiceEntry {
	type: ServiceType;
	id: string;
	name: string;
	description?: string | null;
	status: string;
	tags?: Array<{ tagId: string; name: string; color: string }>;
}

const serviceStatusDot: Record<string, StatusDotStatus> = {
	idle: "neutral",
	running: "success",
	done: "info",
	error: "error",
};

const TYPE_ORDER = Object.keys(SERVICE_TYPE_META) as ServiceType[];

const ID_FIELD: Record<ServiceType, string> = {
	application: "applicationId",
	compose: "composeId",
	postgres: "postgresId",
	mysql: "mysqlId",
	mariadb: "mariadbId",
	mongo: "mongoId",
	redis: "redisId",
};

const serviceKey = (service: ServiceEntry) => `${service.type}:${service.id}`;

/**
 * Services table — one hairline row per service, grouped by service type.
 * Rows are selectable for bulk start/stop; each row has its own menu.
 */
export function ServicesTable({
	projectId,
	services,
	currentEnvironmentId,
}: {
	projectId: string;
	services: ServiceEntry[];
	currentEnvironmentId?: string;
}) {
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkPending, setBulkPending] = useState(false);

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

	const runBulk = async (action: "start" | "stop") => {
		setBulkPending(true);
		let failed = 0;
		for (const service of selectedServices) {
			try {
				const payload = { [ID_FIELD[service.type]]: service.id };
				// biome-ignore lint/suspicious/noExplicitAny: dynamic router access by service type; every service router exposes start/stop
				await (trpcClient as any)[service.type][action].mutate(payload);
			} catch {
				failed += 1;
			}
		}
		setBulkPending(false);
		setSelected(new Set());
		if (failed > 0) {
			toast.error(`${failed} service${failed === 1 ? "" : "s"} failed to ${action}`);
		} else {
			toast.success(
				`${selectedServices.length} service${selectedServices.length === 1 ? "" : "s"} ${action === "start" ? "started" : "stopped"}`,
			);
		}
		await queryClient.invalidateQueries();
	};

	return (
		<div className="space-y-3">
			{selected.size > 0 && (
				<div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2">
					<span className="text-sm text-muted-foreground">{selected.size} selected</span>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={bulkPending}
							onClick={() => runBulk("start")}
						>
							{bulkPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Play className="size-4" />
							)}
							Start
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={bulkPending}
							onClick={() => runBulk("stop")}
						>
							<Square className="size-4" />
							Stop
						</Button>
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
												<span className="flex items-center gap-2 text-sm capitalize">
													<StatusDot status={serviceStatusDot[service.status] ?? "neutral"} />
													{service.status}
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
