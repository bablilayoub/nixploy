"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { Loader2, Pencil, Plug, Server, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { CreateServerDialog } from "@/components/settings/servers/create-server-dialog";
import { ServerCapacityCell } from "@/components/settings/servers/server-capacity-cell";
import { ServerHistoryDialog } from "@/components/settings/servers/server-history-dialog";
import { ServerStatsPopover } from "@/components/settings/servers/server-stats-popover";
import { ServerTerminalDialog } from "@/components/settings/servers/server-terminal-dialog";
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
import { HelpLink } from "@/components/ui/help-link";
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
import { TableNoMatch, TablePagination, TableSearch } from "@/components/ui/table-toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTableView } from "@/hooks/use-table-view";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type ServerRow = inferRouterOutputs<AppRouter>["server"]["all"][number];

/** `metricsConfig.metrics.enabled` defaults to true (the sampler's own default). */
const isMetricsEnabled = (server: ServerRow): boolean =>
	(server.metricsConfig as { metrics?: { enabled?: boolean } } | null)?.metrics?.enabled !== false;

export function ServersView() {
	const trpc = useTRPC();
	const { can, isInstanceAdmin } = useCapabilities();
	const canManage = can("servers.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("servers.manage");
	// A host shell on a Swarm member is platform-wide power (it runs every
	// tenant's unpinned tasks), so the server gate is capability + instance
	// admin; mirror both here so the button is not offered to be refused.
	const canOpenTerminal = canManage && isInstanceAdmin;
	const terminalHint = !canManage
		? manageHint
		: isInstanceAdmin
			? undefined
			: "Server terminals are limited to instance admins";

	const {
		data: servers,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.server.all.queryOptions());

	const view = useTableView({
		rows: servers ?? [],
		search: (server) => [server.name, server.description, server.ipAddress, server.username],
	});

	const serverIds = servers?.map((server) => server.serverId) ?? [];
	const { data: statsByServerId, isPending: statsPending } = useQuery({
		...trpc.server.getStatsBatch.queryOptions({ serverIds }),
		enabled: serverIds.length > 0,
		staleTime: 30_000,
		retry: false,
	});

	const listKey = trpc.server.all.queryKey();

	const testMutation = useSaveMutation(trpc.server.testConnection.mutationOptions(), {
		successMessage: "Connection successful",
	});

	const setupMutation = useSaveMutation(trpc.server.setup.mutationOptions(), {
		successMessage: "Server setup complete",
		invalidate: [listKey],
	});

	const removeMutation = useSaveMutation(trpc.server.remove.mutationOptions(), {
		successMessage: "Server removed",
		invalidate: [listKey],
	});

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

	const updateMutation = useSaveMutation(trpc.server.update.mutationOptions(), {
		successMessage: "Server updated",
		invalidate: [listKey],
		onSuccess: () => setEditing(null),
	});

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
			{/* The page header already says "Servers" and what they are. */}
			<SettingsSection
				title="Connected hosts"
				wide
				actions={
					<>
						<TableSearch view={view} placeholder="Search hosts…" />
						<CreateServerDialog disabled={!canManage} disabledReason={manageHint} />
					</>
				}
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
						<EmptyState
							icon={Server}
							title="No servers"
							description="Add one to deploy workloads on remote hosts."
						/>
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
								<TableHead className="w-44 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{view.visible.length === 0 ? <TableNoMatch view={view} colSpan={7} /> : null}
							{view.visible.map((server) => (
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
											<ServerTerminalDialog
												serverId={server.serverId}
												serverName={server.name}
												disabled={!canOpenTerminal}
												disabledReason={terminalHint}
											/>
											<ServerHistoryDialog
												serverId={server.serverId}
												serverName={server.name}
												metricsEnabled={isMetricsEnabled(server)}
											/>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														title={manageHint}
														disabled={
															!canManage ||
															(testMutation.isPending &&
																testMutation.variables?.serverId === server.serverId)
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
														title={manageHint}
														disabled={
															!canManage ||
															(setupMutation.isPending &&
																setupMutation.variables?.serverId === server.serverId)
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
													<Button
														variant="ghost"
														size="icon"
														title={manageHint}
														disabled={!canManage}
														onClick={() => setEditing(server)}
													>
														<Pencil className="size-4" />
														<span className="sr-only">Edit server</span>
													</Button>
												</TooltipTrigger>
												<TooltipContent>Edit server</TooltipContent>
											</Tooltip>
											<ConfirmDeleteDialog
												title="Remove server"
												description={`Remove "${server.name}" from this organization? The host itself is not touched.`}
												disabled={!canManage}
												disabledReason={manageHint}
												onConfirm={() =>
													removeMutation.mutateAsync({
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
					<TablePagination view={view} noun="hosts" className="mt-3" />
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
									// The API requires a non-empty username; Save is disabled when blank.
									username: editUsername.trim(),
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
								required
								onChange={(e) => setEditUsername(e.target.value)}
							/>
							{!editUsername.trim() && (
								<p className="text-xs text-destructive">An SSH username is required.</p>
							)}
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
								Applied on the next setup run if the node is not yet in the swarm.{" "}
								<HelpLink slug="servers" />
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
								disabled={
									updateMutation.isPending ||
									!editName.trim() ||
									!editIpAddress.trim() ||
									!editUsername.trim()
								}
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
