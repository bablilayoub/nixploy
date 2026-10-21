"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";

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
import { useSaveMutation } from "@/hooks/use-save-mutation";
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
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [ipAddress, setIpAddress] = useState("");
	const [port, setPort] = useState("22");
	const [username, setUsername] = useState("root");
	const [sshKeyId, setSshKeyId] = useState<string | null>(null);
	const [swarmRole, setSwarmRole] = useState<"worker" | "manager">("worker");

	const sshKeysQuery = useQuery(trpc.sshKey.all.queryOptions());
	const sshKeys = sshKeysQuery.data;

	const createMutation = useSaveMutation(trpc.server.create.mutationOptions(), {
		successMessage: "Server added",
		invalidate: [trpc.server.all.queryKey()],
		onSuccess: () => {
			setOpen(false);
			setName("");
			setDescription("");
			setIpAddress("");
			setPort("22");
			setUsername("root");
			setSshKeyId(null);
			setSwarmRole("worker");
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" disabled={disabled} title={disabled ? disabledReason : undefined}>
					<Plus className="size-4" />
					Add server
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add server</DialogTitle>
					<DialogDescription>Register a remote Docker host reachable over SSH.</DialogDescription>
				</DialogHeader>
				<form
					id="create-server"
					className="grid gap-5"
					onSubmit={(event) => {
						event.preventDefault();
						if (createMutation.isPending || disabled) return;
						createMutation.mutate({
							name: name.trim(),
							description: description.trim() || undefined,
							ipAddress: ipAddress.trim(),
							port: Number(port),
							username: username.trim() || undefined,
							sshKeyId,
							swarmRole,
						});
					}}
				>
					<div className="grid gap-2">
						<Label htmlFor="server-name">Name</Label>
						<Input
							id="server-name"
							required
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
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor="server-ip">IP address</Label>
							<Input
								id="server-ip"
								required
								placeholder="203.0.113.10"
								value={ipAddress}
								onChange={(e) => setIpAddress(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="server-port">SSH port</Label>
							<Input
								id="server-port"
								required
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
							<SelectTrigger aria-label="SSH key">
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
						{sshKeysQuery.isError && (
							<div role="alert" className="text-sm">
								<p className="text-muted-foreground">Couldn’t load SSH keys.</p>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => void sshKeysQuery.refetch()}
								>
									Retry SSH keys
								</Button>
							</div>
						)}
					</div>
					<div className="grid gap-2">
						<Label>Swarm role</Label>
						<Select
							value={swarmRole}
							onValueChange={(value) => setSwarmRole(value as "worker" | "manager")}
						>
							<SelectTrigger aria-label="Swarm role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="worker">Worker</SelectItem>
								<SelectItem value="manager">Manager</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Setup joins this host to the primary Swarm. Workers run workloads; managers can also
							schedule Traefik. <HelpLink slug="servers" />
						</p>
					</div>
				</form>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={createMutation.isPending}
						onClick={() => setOpen(false)}
					>
						Cancel
					</Button>
					<Button
						disabled={createMutation.isPending || disabled || !name.trim() || !ipAddress.trim()}
						type="submit"
						form="create-server"
					>
						{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
						Add server
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
