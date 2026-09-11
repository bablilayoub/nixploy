"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { ServicePort } from "./types";

const EMPTY_FORM = {
	publishedPort: "",
	targetPort: "",
	protocol: "tcp" as ServicePort["protocol"],
	publishMode: "ingress" as ServicePort["publishMode"],
};

export function PortsManager({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const writeHint = canWrite ? undefined : capabilityHint("service.write");

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<ServicePort | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [deleteTarget, setDeleteTarget] = useState<ServicePort | null>(null);

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm(EMPTY_FORM);
		}
	}, [dialogOpen]);

	const {
		data: ports,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(trpc.port.byApplication.queryOptions({ applicationId }));

	const invalidate = [trpc.port.byApplication.queryKey({ applicationId })];

	const create = useSaveMutation(
		trpc.port.create.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Port created", invalidate },
	);
	const update = useSaveMutation(
		trpc.port.update.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Port updated", invalidate },
	);
	const remove = useSaveMutation(
		trpc.port.delete.mutationOptions({ onSuccess: () => setDeleteTarget(null) }),
		{ successMessage: "Port deleted", invalidate },
	);

	const isPending = create.isPending || update.isPending;
	const publishedPort = Number(form.publishedPort);
	const targetPort = Number(form.targetPort);
	const isValid =
		Number.isInteger(publishedPort) &&
		publishedPort >= 1 &&
		publishedPort <= 65535 &&
		Number.isInteger(targetPort) &&
		targetPort >= 1 &&
		targetPort <= 65535;

	const openEdit = (port: ServicePort) => {
		setEditing(port);
		setForm({
			publishedPort: String(port.publishedPort),
			targetPort: String(port.targetPort),
			protocol: port.protocol,
			publishMode: port.publishMode,
		});
		setDialogOpen(true);
	};

	const onSubmit = () => {
		const payload = {
			publishedPort,
			targetPort,
			protocol: form.protocol,
			publishMode: form.publishMode,
		};
		if (editing) {
			update.mutate({ portId: editing.portId, ...payload });
		} else {
			create.mutate({ applicationId, ...payload });
		}
	};

	return (
		<>
			<SettingsSection
				title="Ports"
				description="Publish container ports on the swarm, bypassing the reverse proxy."
				actions={
					<Button
						size="sm"
						onClick={() => setDialogOpen(true)}
						disabled={!canWrite}
						title={writeHint}
					>
						<Plus className="size-4" />
						Add port
					</Button>
				}
			>
				<QueryState
					isPending={isLoading}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!ports || ports.length === 0}
					skeleton={
						<div className="flex flex-col gap-2">
							{Array.from({ length: 2 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
								<Skeleton key={i} className="h-10 w-full" />
							))}
						</div>
					}
					empty={
						<div className="flex flex-col items-center gap-2 py-10 text-center">
							<Network className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">No ports published.</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Published</TableHead>
								<TableHead>Target</TableHead>
								<TableHead>Protocol</TableHead>
								<TableHead>Mode</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(ports ?? []).map((port) => (
								<TableRow key={port.portId}>
									<TableCell className="font-mono text-xs">{port.publishedPort}</TableCell>
									<TableCell className="font-mono text-xs">{port.targetPort}</TableCell>
									<TableCell>
										<span className="text-sm uppercase">{port.protocol}</span>
									</TableCell>
									<TableCell className="capitalize text-muted-foreground">
										{port.publishMode}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit"
												disabled={!canWrite}
												title={writeHint}
												onClick={() => openEdit(port)}
											>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete"
												disabled={!canWrite}
												title={writeHint}
												onClick={() => setDeleteTarget(port)}
											>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueryState>
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit port" : "Add port"}</DialogTitle>
						<DialogDescription>
							Ports are applied to the service on the next update.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							onSubmit();
						}}
						className="grid gap-4 sm:grid-cols-2"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="published-port">Published port</Label>
							<Input
								id="published-port"
								type="number"
								min={1}
								max={65535}
								placeholder="8080"
								value={form.publishedPort}
								onChange={(e) => setForm((f) => ({ ...f, publishedPort: e.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="target-port">Target port</Label>
							<Input
								id="target-port"
								type="number"
								min={1}
								max={65535}
								placeholder="3000"
								value={form.targetPort}
								onChange={(e) => setForm((f) => ({ ...f, targetPort: e.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Protocol</Label>
							<Select
								value={form.protocol}
								onValueChange={(v) =>
									setForm((f) => ({
										...f,
										protocol: v as ServicePort["protocol"],
									}))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="tcp">TCP</SelectItem>
									<SelectItem value="udp">UDP</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Publish mode</Label>
							<Select
								value={form.publishMode}
								onValueChange={(v) =>
									setForm((f) => ({
										...f,
										publishMode: v as ServicePort["publishMode"],
									}))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ingress">Ingress</SelectItem>
									<SelectItem value="host">Host</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								Ingress load-balances across the swarm; host binds the port on the node that runs
								the task. <HelpLink slug="deploy" />
							</p>
						</div>
						<DialogFooter className="sm:col-span-2">
							<Button type="submit" disabled={!isValid || isPending}>
								{isPending && <Loader2 className="size-4 animate-spin" />}
								{editing ? "Save" : "Create"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete port?</AlertDialogTitle>
						<AlertDialogDescription>
							Port {deleteTarget?.publishedPort} → {deleteTarget?.targetPort} will stop being
							published.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleteTarget) remove.mutate({ portId: deleteTarget.portId });
							}}
							disabled={remove.isPending}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
