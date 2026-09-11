"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { ComposeService } from "@/components/compose/compose-detail";
import { SettingsSection } from "@/components/layout/settings-section";
import { LogViewer } from "@/components/services/log-viewer";
import { ServiceTerminal } from "@/components/services/service-terminal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

type Mode = "terminal" | "logs";

function containerLabel(row: { name: string; service: string | null; state: string }): string {
	const service = row.service ? `${row.service} · ` : "";
	return `${service}${row.name}`;
}

/**
 * Shared compose Terminal / Logs surface with a container picker when the
 * stack has more than one container.
 */
export function ComposeRuntimeTab({ compose, mode }: { compose: ComposeService; mode: Mode }) {
	const trpc = useTRPC();
	const containersQuery = useQuery({
		...trpc.compose.containers.queryOptions({ composeId: compose.composeId }),
		refetchInterval: 15_000,
	});

	const containers = containersQuery.data ?? [];
	const running = containers.filter((row) => row.state === "running");
	const options = running.length > 0 ? running : containers;

	const [selectedId, setSelectedId] = useState<string | null>(null);

	useEffect(() => {
		if (options.length === 0) {
			setSelectedId(null);
			return;
		}
		setSelectedId((current) => {
			if (current && options.some((row) => row.id === current)) return current;
			return options[0]?.id ?? null;
		});
	}, [options]);

	const selected = options.find((row) => row.id === selectedId) ?? null;
	const title = mode === "terminal" ? "Terminal" : "Logs";
	const description =
		mode === "terminal"
			? "Interactive shell into a container in this compose stack."
			: "Real-time logs from a container in this compose stack.";

	return (
		<SettingsSection
			title={title}
			description={description}
			bare
			actions={
				<div className="flex flex-wrap items-center gap-2">
					{containersQuery.isLoading ? (
						<Skeleton className="h-9 w-56" />
					) : options.length > 0 ? (
						<Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
							<SelectTrigger className="min-w-[14rem] max-w-md" size="default">
								<SelectValue placeholder="Select container" />
							</SelectTrigger>
							<SelectContent>
								{options.map((row) => (
									<SelectItem key={row.id} value={row.id}>
										<span className="flex items-center gap-2">
											<span className="truncate">{containerLabel(row)}</span>
											{row.state !== "running" && (
												<Badge variant="outline" className="text-[10px]">
													{row.state}
												</Badge>
											)}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void containersQuery.refetch()}
						disabled={containersQuery.isFetching}
					>
						<RefreshCw
							className={containersQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"}
						/>
						Refresh
					</Button>
				</div>
			}
		>
			{containersQuery.isError ? (
				<p className="py-10 text-center text-sm text-muted-foreground">
					Could not list containers for this compose service.
				</p>
			) : options.length === 0 && !containersQuery.isLoading ? (
				<div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
					<p className="text-sm font-medium text-foreground">No containers yet</p>
					<p className="max-w-sm text-sm text-muted-foreground">
						Deploy the compose stack first, then pick a service container here.
					</p>
				</div>
			) : selected && selected.state === "running" ? (
				mode === "terminal" ? (
					<ServiceTerminal
						appName={compose.appName}
						containerId={selected.id}
						serverId={compose.serverId}
					/>
				) : (
					<LogViewer
						appName={compose.appName}
						containerId={selected.id}
						serverId={compose.serverId}
					/>
				)
			) : selected ? (
				<p className="py-10 text-center text-sm text-muted-foreground">
					Container “{selected.name}” is not running ({selected.state}). Start it or pick another.
				</p>
			) : (
				<Skeleton className="h-[26rem] w-full rounded-lg" />
			)}
		</SettingsSection>
	);
}
