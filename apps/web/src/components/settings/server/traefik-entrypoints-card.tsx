"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
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

type EntrypointProtocol = "tcp" | "udp";

/** Same slug rule the server enforces (`assertEntrypointName`). */
const NAME_RE = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

/**
 * Extra TCP/UDP entrypoints for layer-4 routing (databases, game servers,
 * SMTP, DNS…). A `tcp`/`udp` domain binds to one of these by name.
 *
 * Instance-level on purpose: the port is opened on the host for everyone, and
 * entrypoints live in Traefik's **static** configuration, which is only read
 * when the proxy starts. Saving here therefore recreates the Traefik task and
 * briefly interrupts every route on this instance.
 */
export function TraefikEntrypointsCard() {
	const trpc = useTRPC();
	const entrypointsQuery = useQuery(trpc.traefik.listEntrypoints.queryOptions());

	const [dialogOpen, setDialogOpen] = useState(false);
	const [name, setName] = useState("");
	const [port, setPort] = useState("");
	const [protocol, setProtocol] = useState<EntrypointProtocol>("tcp");
	const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

	const invalidate = [trpc.traefik.listEntrypoints.queryKey()];

	const createMutation = useSaveMutation(
		trpc.traefik.createEntrypoint.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Entrypoint added — Traefik restarted", invalidate },
	);
	const deleteMutation = useSaveMutation(
		trpc.traefik.deleteEntrypoint.mutationOptions({ onSuccess: () => setDeleting(null) }),
		{ successMessage: "Entrypoint removed — Traefik restarted", invalidate },
	);

	const openCreate = () => {
		setName("");
		setPort("");
		setProtocol("tcp");
		setDialogOpen(true);
	};

	const submit = () => {
		const trimmedName = name.trim().toLowerCase();
		if (!NAME_RE.test(trimmedName)) {
			toast.error("Use 2 to 32 lowercase letters, digits and dashes, e.g. pg-15432");
			return;
		}
		const parsedPort = Number.parseInt(port.trim(), 10);
		if (!Number.isFinite(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
			toast.error("Pick an unprivileged port between 1024 and 65535");
			return;
		}
		createMutation.mutate({ name: trimmedName, port: parsedPort, protocol });
	};

	const entrypoints = entrypointsQuery.data ?? [];

	return (
		<>
			<SettingsSection
				title="TCP and UDP entrypoints"
				description="Extra ports Traefik listens on, so a service can be routed at layer 4 instead of over HTTP."
				actions={
					<Button size="sm" onClick={openCreate}>
						<Plus className="size-4" />
						Add entrypoint
					</Button>
				}
			>
				<p className="text-xs text-muted-foreground">
					Adding or removing an entrypoint restarts Traefik: entrypoints live in its static
					configuration, which is only read at start. Every route on this instance is unavailable
					for a few seconds. <HelpLink slug="domains" />
				</p>
				<QueryState
					isPending={entrypointsQuery.isLoading}
					isError={entrypointsQuery.isError}
					error={entrypointsQuery.error}
					onRetry={() => entrypointsQuery.refetch()}
					skeleton={<Skeleton className="h-24 w-full" />}
					isEmpty={entrypoints.length === 0}
					empty={
						<EmptyState
							title="No extra entrypoints"
							description="Traefik serves HTTP on 80 and HTTPS on 443. Add an entrypoint to route raw TCP or UDP traffic."
							action={
								<Button size="sm" onClick={openCreate}>
									<Plus className="size-4" />
									Add entrypoint
								</Button>
							}
						/>
					}
				>
					<TableCard framed={false}>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Port</TableHead>
									<TableHead>Protocol</TableHead>
									<TableHead className="w-16 text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{entrypoints.map((entrypoint) => (
									<TableRow key={entrypoint.traefikEntrypointId}>
										<TableCell className="font-mono text-xs">{entrypoint.name}</TableCell>
										<TableCell className="font-mono text-xs">{entrypoint.port}</TableCell>
										<TableCell>
											<Badge variant="outline" className="text-xs uppercase">
												{entrypoint.protocol}
											</Badge>
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Delete entrypoint ${entrypoint.name}`}
												onClick={() =>
													setDeleting({
														id: entrypoint.traefikEntrypointId,
														name: entrypoint.name,
													})
												}
											>
												<Trash2 className="size-3.5 text-destructive" />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableCard>
				</QueryState>
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Add entrypoint</DialogTitle>
						<DialogDescription>
							Traefik will listen on this port and the host will publish it. Saving restarts the
							proxy, so every route is briefly unavailable.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
						className="space-y-4"
					>
						<div className="space-y-1.5">
							<Label htmlFor="entrypoint-name">Name</Label>
							<Input
								id="entrypoint-name"
								placeholder="pg-15432"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Lowercase letters, digits and dashes. Domains reference the entrypoint by this name.
							</p>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="entrypoint-port">Port</Label>
								<Input
									id="entrypoint-port"
									placeholder="15432"
									inputMode="numeric"
									value={port}
									onChange={(event) => setPort(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label>Protocol</Label>
								<Select
									value={protocol}
									onValueChange={(value) => setProtocol(value as EntrypointProtocol)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="tcp">TCP</SelectItem>
										<SelectItem value="udp">UDP</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							Privileged ports and the ports the platform already uses are rejected. Pick something
							memorable, such as 15432 for Postgres.
						</p>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Add and restart Traefik
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove entrypoint</AlertDialogTitle>
						<AlertDialogDescription>
							Remove <span className="font-mono">{deleting?.name}</span>? The port is unpublished
							and Traefik restarts, so every route on this instance is briefly unavailable. Domains
							still using it must be removed first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (deleting) deleteMutation.mutate({ traefikEntrypointId: deleting.id });
							}}
						>
							{deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Remove and restart Traefik
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
