"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
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
import { useTRPC } from "@/lib/trpc";

export function CreateServerDialog({
	disabled,
	disabledReason,
}: {
	/** Caller lacks `servers.manage` — keep the trigger visible but inert. */
	disabled?: boolean;
	disabledReason?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [ipAddress, setIpAddress] = useState("");
	const [port, setPort] = useState("22");
	const [username, setUsername] = useState("root");
	const [sshKeyId, setSshKeyId] = useState<string | null>(null);
	const [swarmRole, setSwarmRole] = useState<"worker" | "manager">("worker");

	const { data: sshKeys } = useQuery(trpc.sshKey.all.queryOptions());

	const createMutation = useMutation(
		trpc.server.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Server added");
				await queryClient.invalidateQueries({
					queryKey: trpc.server.all.queryKey(),
				});
				setOpen(false);
				setName("");
				setDescription("");
				setIpAddress("");
				setPort("22");
				setUsername("root");
				setSshKeyId(null);
				setSwarmRole("worker");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" disabled={disabled} title={disabled ? disabledReason : undefined}>
					<Plus className="size-4" />
					Add Server
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add server</DialogTitle>
					<DialogDescription>Register a remote Docker host reachable over SSH.</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="server-name">Name</Label>
						<Input
							id="server-name"
							placeholder="e.g. production-eu-1"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="server-description">Description (optional)</Label>
						<Input
							id="server-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>
					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="server-ip">IP address</Label>
							<Input
								id="server-ip"
								placeholder="203.0.113.10"
								value={ipAddress}
								onChange={(e) => setIpAddress(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="server-port">SSH port</Label>
							<Input
								id="server-port"
								type="number"
								min={1}
								max={65535}
								value={port}
								onChange={(e) => setPort(e.target.value)}
							/>
						</div>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="server-username">Username</Label>
						<Input
							id="server-username"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label>SSH key</Label>
						<Select
							value={sshKeyId ?? "none"}
							onValueChange={(value) => setSshKeyId(value === "none" ? null : value)}
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
							value={swarmRole}
							onValueChange={(value) => setSwarmRole(value as "worker" | "manager")}
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
							Setup joins this host to the primary Swarm. Workers run workloads; managers can also
							schedule Traefik.
						</p>
					</div>
				</div>
				<DialogFooter>
					<Button
						disabled={createMutation.isPending || !name || !ipAddress}
						onClick={() =>
							createMutation.mutate({
								name,
								description: description || undefined,
								ipAddress,
								port: Number(port) || 22,
								username: username || undefined,
								sshKeyId,
								swarmRole,
							})
						}
					>
						{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
						Add server
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
