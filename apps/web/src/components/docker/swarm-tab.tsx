"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Lock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/services/empty-state";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps } from "./docker-view";

type ServiceRow = {
	ID: string;
	Name: string;
	Mode: string;
	Replicas: string;
	Image: string;
	Ports: string;
	protected?: boolean;
};

type NodeRow = {
	ID: string;
	Hostname: string;
	Status: string;
	Availability: string;
	ManagerStatus: string;
	EngineVersion: string;
};

/**
 * `docker node ls` / `docker service ls` exit non-zero on a host that is not
 * a swarm manager. That is the normal state of a plain worker or standalone
 * daemon, not an unreachable engine — render the empty state instead.
 */
function isSwarmInactiveError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return /not a swarm manager|not part of a swarm|swarm mode|swarm is not active/i.test(message);
}

export function SwarmTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const servicesQuery = useQuery(trpc.docker.swarmServices.queryOptions({ serverId }));
	const nodesQuery = useQuery(trpc.docker.nodes.queryOptions({ serverId }));

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.docker.swarmServices.queryKey({ serverId }),
		});
		queryClient.invalidateQueries({
			queryKey: trpc.docker.nodes.queryKey({ serverId }),
		});
	};

	const nodeMutation = useSaveMutation(
		trpc.docker.nodeUpdate.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: (_data, variables) => toast.success(`Node set to ${variables.availability}`),
		}),
		{
			invalidate: [
				trpc.docker.swarmServices.queryKey({ serverId }),
				trpc.docker.nodes.queryKey({ serverId }),
			],
		},
	);

	if (servicesQuery.isLoading || nodesQuery.isLoading) {
		return <Skeleton className="h-64 w-full" />;
	}
	if (servicesQuery.isError && !isSwarmInactiveError(servicesQuery.error)) {
		return <DockerError error={servicesQuery.error} />;
	}
	if (nodesQuery.isError && !isSwarmInactiveError(nodesQuery.error)) {
		return <DockerError error={nodesQuery.error} />;
	}

	const services = (servicesQuery.isError ? [] : (servicesQuery.data ?? [])) as ServiceRow[];
	const nodes = (nodesQuery.isError ? [] : (nodesQuery.data ?? [])) as NodeRow[];

	// The router answers `[]` for both lists on a worker or standalone engine.
	if (nodes.length === 0 && services.length === 0) {
		return (
			<div className="pt-4">
				<EmptyState
					icon={Boxes}
					title="Swarm mode is inactive on this server"
					description="This engine is not a swarm manager, so it cannot list nodes or services. Pick the Nixploy host or a manager node to inspect the cluster."
					action={
						<Button variant="outline" size="sm" onClick={invalidate}>
							<RefreshCw className="size-3.5" />
							Refresh
						</Button>
					}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-6 pt-4">
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-medium">Nodes</h3>
					<Button variant="outline" size="sm" onClick={invalidate}>
						<RefreshCw className="size-3.5" />
						Refresh
					</Button>
				</div>
				<TableCard>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Hostname</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Engine</TableHead>
								<TableHead>Availability</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{nodes.map((node) => (
								<TableRow key={node.ID}>
									<TableCell className="font-mono text-xs font-medium">{node.Hostname}</TableCell>
									<TableCell>
										<Badge
											variant="outline"
											className={node.Status === "Ready" ? "text-success" : "text-warning"}
										>
											{node.Status}
										</Badge>
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{node.ManagerStatus || "Worker"}
									</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{node.EngineVersion}
									</TableCell>
									<TableCell>
										<Select
											value={node.Availability.toLowerCase()}
											disabled={nodeMutation.isPending}
											onValueChange={(value) =>
												nodeMutation.mutate({
													serverId,
													nodeId: node.ID,
													availability: value as "active" | "pause" | "drain",
												})
											}
										>
											<SelectTrigger className="h-7 w-28 text-xs">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="active">Active</SelectItem>
												<SelectItem value="pause">Pause</SelectItem>
												<SelectItem value="drain">Drain</SelectItem>
											</SelectContent>
										</Select>
									</TableCell>
								</TableRow>
							))}
							{nodes.length === 0 && (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-10 text-center text-sm text-muted-foreground"
									>
										No swarm nodes (swarm mode inactive on this server).
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</TableCard>
			</div>

			<div className="space-y-3">
				<h3 className="text-sm font-medium">Services</h3>
				<TableCard>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Mode</TableHead>
								<TableHead>Replicas</TableHead>
								<TableHead>Image</TableHead>
								<TableHead>Ports</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{services.map((service) => (
								<TableRow key={service.ID}>
									<TableCell>
										<span className="font-mono text-xs font-medium">{service.Name}</span>{" "}
										{service.protected && (
											<Badge variant="outline" className="ml-1.5 text-muted-foreground">
												<Lock className="mr-1 size-3" />
												protected
											</Badge>
										)}
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">{service.Mode}</TableCell>
									<TableCell className="font-mono text-xs">{service.Replicas}</TableCell>
									<TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
										{service.Image}
									</TableCell>
									<TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
										{service.Ports || "—"}
									</TableCell>
								</TableRow>
							))}
							{services.length === 0 && (
								<TableRow>
									<TableCell
										colSpan={5}
										className="py-10 text-center text-sm text-muted-foreground"
									>
										No swarm services on this server.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</TableCard>
			</div>
		</div>
	);
}
