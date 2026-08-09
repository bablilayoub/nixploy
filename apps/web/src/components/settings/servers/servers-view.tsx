"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { Loader2, Pencil, Plug, Server, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { CreateServerDialog } from "@/components/settings/servers/create-server-dialog";
import { ServerCapacityCell } from "@/components/settings/servers/server-capacity-cell";
import { ServerStatsPopover } from "@/components/settings/servers/server-stats-popover";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageHeader, StatusDot } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type ServerRow = inferRouterOutputs<AppRouter>["server"]["all"][number];

export function ServersView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const {
		data: servers,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.server.all.queryOptions());

	const serverIds = servers?.map((server) => server.serverId) ?? [];
	const { data: statsByServerId, isPending: statsPending } = useQuery({
		...trpc.server.getStatsBatch.queryOptions({ serverIds }),
		enabled: serverIds.length > 0,
		staleTime: 30_000,
		retry: false,
	});

	const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.server.all.queryKey() });

	const testMutation = useMutation(
		trpc.server.testConnection.mutationOptions({
			onSuccess: () => toast.success("Connection successful"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const setupMutation = useMutation(
		trpc.server.setup.mutationOptions({
			onSuccess: async () => {
				toast.success("Server setup complete");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const removeMutation = useMutation(
		trpc.server.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("Server removed");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const [editing, setEditing] = useState<ServerRow | null>(null);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editIpAddress, setEditIpAddress] = useState("");
	const [editPort, setEditPort] = useState("22");
	const [editUsername, setEditUsername] = useState("root");
	const [editSshKeyId, setEditSshKeyId] = useState<string | null>(null);
	const [editSwarmRole, setEditSwarmRole] = useState<"worker" | "manager">("worker");
	const [editMetricsEnabled, setEditMetricsEnabled] = useState(true);

	const { data: sshKeys } = useQuery(trpc.sshKey.all.queryOptions());

	useEffect(() => {
		if (editing) {
			setEditName(editing.name);
			setEditDescription(editing.description ?? "");
			setEditIpAddress(editing.ipAddress);
			setEditPort(String(editing.port));
			setEditUsername(editing.username);
			setEditSshKeyId(editing.sshKeyId ?? null);
			setEditSwarmRole(editing.swarmRole);
			const metricsConfig = editing.metricsConfig as { metrics?: { enabled?: boolean } } | null;
			setEditMetricsEnabled(metricsConfig?.metrics?.enabled !== false);
		}
	}, [editing]);

	const updateMutation = useMutation(
		trpc.server.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Server updated");
				await invalidate();
				setEditing(null);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				title="Servers"
				description={
					<span>
						Remote Docker hosts that join the primary Swarm over SSH. Drain or pause nodes in{" "}
						<Link href="/dashboard/docker" className="underline underline-offset-2">
							Docker → Swarm
						</Link>
						. Pin apps with Advanced → Placement constraints.
					</span>
				}
			/>
			<SettingsSection
				title="Servers"
				description="Remote Docker hosts connected over SSH."
				actions={<CreateServerDialog />}
			>
				<QueryState
					isPending={isPending}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!servers || servers.length === 0}
					skeleton={
						<div className="grid gap-2">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					}
					empty={
						<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
							<Server className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								No servers yet. Add one to deploy workloads on remote hosts.
							</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead className="hidden md:table-cell">Address</TableHead>
								<TableHead className="hidden sm:table-cell">Role</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="hidden lg:table-cell">Capacity</TableHead>
								<TableHead className="hidden md:table-cell">Added</TableHead>
								<TableHead className="w-36 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(servers ?? []).map((server) => (
								<TableRow key={server.serverId}>
									<TableCell>
										<div className="grid">
											<span className="font-medium">{server.name}</span>
											{server.description && (
												<span className="text-xs text-muted-foreground">{server.description}</span>
											)}
										</div>
									</TableCell>
									<TableCell className="hidden md:table-cell">
										<code className="text-xs text-muted-foreground">
											{server.username}@{server.ipAddress}:{server.port}
										</code>
									</TableCell>
									<TableCell className="hidden text-sm capitalize sm:table-cell">
										{server.swarmRole}
									</TableCell>
									<TableCell>
										<span className="flex items-center gap-2 text-sm">
											<StatusDot
												status={server.serverStatus === "active" ? "success" : "neutral"}
											/>
											{server.serverStatus}
										</span>
									</TableCell>
									<TableCell className="hidden lg:table-cell">
										<ServerCapacityCell
											stats={statsByServerId?.[server.serverId]}
											isPending={serverIds.length > 0 && statsPending}
										/>
									</TableCell>
									<TableCell className="hidden text-muted-foreground md:table-cell">
										{format(new Date(server.createdAt), "MMM d, yyyy")}
									</TableCell>
									<TableCell>
										<div className="flex items-center justify-end">
											<ServerStatsPopover serverId={server.serverId} />
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														disabled={
															testMutation.isPending &&
															testMutation.variables?.serverId === server.serverId
														}
														onClick={() =>
															testMutation.mutate({
																serverId: server.serverId,
															})
														}
													>
														{testMutation.isPending &&
														testMutation.variables?.serverId === server.serverId ? (
															<Loader2 className="size-4 animate-spin" />
														) : (
															<Plug className="size-4" />
														)}
														<span className="sr-only">Test connection</span>
													</Button>
												</TooltipTrigger>
												<TooltipContent>Test connection</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														disabled={
															setupMutation.isPending &&
															setupMutation.variables?.serverId === server.serverId
														}
														onClick={() =>
															setupMutation.mutate({
																serverId: server.serverId,
															})
														}
													>
														{setupMutation.isPending &&
														setupMutation.variables?.serverId === server.serverId ? (
															<Loader2 className="size-4 animate-spin" />
														) : (
															<Wrench className="size-4" />
														)}
														<span className="sr-only">Run setup</span>
													</Button>
												</TooltipTrigger>
												<TooltipContent>Run setup (Docker + Swarm join)</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button variant="ghost" size="icon" onClick={() => setEditing(server)}>
														<Pencil className="size-4" />
														<span className="sr-only">Edit server</span>
													</Button>
												</TooltipTrigger>
												<TooltipContent>Edit server</TooltipContent>
											</Tooltip>
											<ConfirmDeleteDialog
												title="Remove server"
												description={`Remove "${server.name}" from this organization? The host itself is not touched.`}
												isPending={removeMutation.isPending}
												onConfirm={() =>
													removeMutation.mutate({
														serverId: server.serverId,
													})
												}
											/>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueryState>
			</SettingsSection>
			<Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit server</DialogTitle>
						<DialogDescription>Update the SSH connection details.</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (editing) {
								updateMutation.mutate({
									serverId: editing.serverId,
									name: editName.trim(),
									description: editDescription.trim() || null,
									ipAddress: editIpAddress.trim(),
									port: Number(editPort) || 22,
									username: editUsername.trim() || undefined,
									sshKeyId: editSshKeyId,
									swarmRole: editSwarmRole,
									metricsEnabled: editMetricsEnabled,
								});
							}
						}}
						className="grid gap-4"
					>
						<div className="grid gap-2">
							<Label htmlFor="edit-server-name">Name</Label>
							<Input
								id="edit-server-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-server-description">Description (optional)</Label>
							<Input
								id="edit-server-description"
								value={editDescription}
								onChange={(e) => setEditDescription(e.target.value)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-server-ip">IP address</Label>
								<Input
									id="edit-server-ip"
									value={editIpAddress}
									onChange={(e) => setEditIpAddress(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-server-port">SSH port</Label>
								<Input
									id="edit-server-port"
									type="number"
									min={1}
									max={65535}
									value={editPort}
									onChange={(e) => setEditPort(e.target.value)}
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-server-username">Username</Label>
							<Input
								id="edit-server-username"
								value={editUsername}
								onChange={(e) => setEditUsername(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label>SSH key</Label>
							<Select
								value={editSshKeyId ?? "none"}
								onValueChange={(value) => setEditSshKeyId(value === "none" ? null : value)}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select an SSH key" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">None</SelectItem>
									{(sshKeys ?? []).map((key) => (
										<SelectItem key={key.sshKeyId} value={key.sshKeyId}>
											{key.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label>Swarm role</Label>
							<Select
								value={editSwarmRole}
								onValueChange={(value) => setEditSwarmRole(value as "worker" | "manager")}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="worker">Worker</SelectItem>
									<SelectItem value="manager">Manager</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Applied on the next setup run if the node is not yet in the swarm.
							</p>
						</div>
						<div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
							<div className="grid gap-0.5">
								<Label htmlFor="edit-server-metrics">Metrics history</Label>
								<p className="text-xs text-muted-foreground">
									Sample host and container stats over SSH every 30s.
								</p>
							</div>
							<Switch
								id="edit-server-metrics"
								checked={editMetricsEnabled}
								onCheckedChange={setEditMetricsEnabled}
							/>
						</div>
						<DialogFooter>
							<Button
								type="submit"
								disabled={updateMutation.isPending || !editName.trim() || !editIpAddress.trim()}
							>
								{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
