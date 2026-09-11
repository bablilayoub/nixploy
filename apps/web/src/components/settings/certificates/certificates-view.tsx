"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { Award, Loader2, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
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
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { missingCapabilityHint } from "@/lib/capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type CertificateRow = inferRouterOutputs<AppRouter>["certificate"]["all"][number];

export function CertificatesView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const { can } = useCapabilities();
	const canManage = can("certificates.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("certificates.manage");
	const [name, setName] = useState("");
	const [certificateData, setCertificateData] = useState("");
	const [privateKey, setPrivateKey] = useState("");

	const {
		data: certificates,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.certificate.all.queryOptions());

	useEffect(() => {
		if (!open) {
			setName("");
			setCertificateData("");
			setPrivateKey("");
		}
	}, [open]);

	const createMutation = useMutation(
		trpc.certificate.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Certificate added");
				await queryClient.invalidateQueries({
					queryKey: trpc.certificate.all.queryKey(),
				});
				setOpen(false);
			},
			onError: (error) => toastError(error),
		}),
	);

	const deleteMutation = useMutation(
		trpc.certificate.delete.mutationOptions({
			onSuccess: async () => {
				toast.success("Certificate removed");
				await queryClient.invalidateQueries({
					queryKey: trpc.certificate.all.queryKey(),
				});
			},
			onError: (error) => toastError(error),
		}),
	);

	const [editing, setEditing] = useState<CertificateRow | null>(null);
	const [editName, setEditName] = useState("");
	const [editCertificateData, setEditCertificateData] = useState("");
	const [editPrivateKey, setEditPrivateKey] = useState("");
	const [editAutoRenew, setEditAutoRenew] = useState(false);

	useEffect(() => {
		if (editing) {
			setEditName(editing.name);
			setEditCertificateData(editing.certificateData);
			setEditPrivateKey("");
			setEditAutoRenew(editing.autoRenew);
		}
	}, [editing]);

	const updateMutation = useMutation(
		trpc.certificate.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Certificate updated");
				await queryClient.invalidateQueries({
					queryKey: trpc.certificate.all.queryKey(),
				});
				setEditing(null);
			},
			onError: (error) => toastError(error),
		}),
	);

	return (
		<div className="flex flex-col gap-8">
			<Dialog open={open} onOpenChange={setOpen}>
				<PageHeader title="Certificates" description="Custom TLS certificates served by Traefik." />
				<SettingsSection
					title={
						<span className="flex items-center gap-2">
							<Award className="size-4 text-muted-foreground" />
							Certificates
						</span>
					}
					description="Certificates stored on this server."
					actions={
						<DialogTrigger asChild>
							<Button size="sm" disabled={!canManage} title={manageHint}>
								<Plus className="size-4" />
								Add certificate
							</Button>
						</DialogTrigger>
					}
				>
					<QueryState
						isPending={isPending}
						isError={isError}
						error={error}
						onRetry={() => refetch()}
						isEmpty={!certificates || certificates.length === 0}
						skeleton={
							<div className="grid gap-2">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
							</div>
						}
						empty={
							<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
								<Award className="size-8 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">
									No certificates yet. Add one to serve custom TLS certificates.
								</p>
							</div>
						}
					>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead className="hidden md:table-cell">Path</TableHead>
									<TableHead className="hidden md:table-cell">Server</TableHead>
									<TableHead>Auto-renew</TableHead>
									<TableHead className="hidden md:table-cell">Created</TableHead>
									<TableHead className="w-12" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{(certificates ?? []).map((certificate) => (
									<TableRow key={certificate.certificateId}>
										<TableCell className="font-medium">{certificate.name}</TableCell>
										<TableCell className="hidden md:table-cell">
											<code className="block max-w-56 truncate text-xs text-muted-foreground">
												{certificate.certificatePath}
											</code>
										</TableCell>
										<TableCell className="hidden text-muted-foreground md:table-cell">
											{certificate.serverName ?? "This server"}
										</TableCell>
										<TableCell>
											<span className="flex items-center gap-2 text-sm">
												<StatusDot status={certificate.autoRenew ? "success" : "neutral"} />
												{certificate.autoRenew ? "On" : "Off"}
											</span>
										</TableCell>
										<TableCell className="hidden text-muted-foreground md:table-cell">
											{format(new Date(certificate.createdAt), "MMM d, yyyy")}
										</TableCell>
										<TableCell>
											<div className="flex items-center justify-end">
												<Button
													variant="ghost"
													size="icon"
													disabled={!canManage}
													title={manageHint}
													onClick={() => setEditing(certificate)}
												>
													<Pencil className="size-4" />
													<span className="sr-only">Edit certificate</span>
												</Button>
												<ConfirmDeleteDialog
													title="Remove certificate"
													description={`Remove "${certificate.name}"? Domains using it will fall back to the default certificate.`}
													disabled={!canManage}
													disabledReason={manageHint}
													onConfirm={() =>
														deleteMutation.mutateAsync({
															certificateId: certificate.certificateId,
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
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Add certificate</DialogTitle>
						<DialogDescription>Paste the PEM certificate chain and private key.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="cert-name">Name</Label>
							<Input
								id="cert-name"
								placeholder="e.g. wildcard-example-com"
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="cert-data">Certificate (PEM)</Label>
							<Textarea
								id="cert-data"
								className="h-32 font-mono text-xs"
								placeholder="-----BEGIN CERTIFICATE-----"
								value={certificateData}
								onChange={(e) => setCertificateData(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="cert-key">Private key (PEM)</Label>
							<Textarea
								id="cert-key"
								className="h-32 font-mono text-xs"
								placeholder="-----BEGIN PRIVATE KEY-----"
								value={privateKey}
								onChange={(e) => setPrivateKey(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							disabled={createMutation.isPending || !name || !certificateData || !privateKey}
							onClick={() =>
								createMutation.mutate({
									name,
									certificateData,
									privateKey,
								})
							}
						>
							{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Add certificate
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Edit certificate</DialogTitle>
						<DialogDescription>
							Update the name or replace the PEM data. Leave the private key blank to keep the
							current one.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (editing) {
								updateMutation.mutate({
									certificateId: editing.certificateId,
									name: editName.trim(),
									autoRenew: editAutoRenew,
									...(editCertificateData.trim() ? { certificateData: editCertificateData } : {}),
									...(editPrivateKey.trim() ? { privateKey: editPrivateKey } : {}),
								});
							}
						}}
						className="grid gap-4"
					>
						<div className="grid gap-2">
							<Label htmlFor="edit-cert-name">Name</Label>
							<Input
								id="edit-cert-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-cert-data">Certificate (PEM)</Label>
							<Textarea
								id="edit-cert-data"
								className="h-32 font-mono text-xs"
								value={editCertificateData}
								onChange={(e) => setEditCertificateData(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-cert-key">Private key (PEM)</Label>
							<Textarea
								id="edit-cert-key"
								className="h-32 font-mono text-xs"
								placeholder="Leave blank to keep the current key"
								value={editPrivateKey}
								onChange={(e) => setEditPrivateKey(e.target.value)}
							/>
						</div>
						<div className="flex items-center gap-2">
							<Switch
								id="edit-cert-autorenew"
								checked={editAutoRenew}
								onCheckedChange={setEditAutoRenew}
							/>
							<Label htmlFor="edit-cert-autorenew" className="font-normal">
								Auto-renew
							</Label>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={updateMutation.isPending || !editName.trim()}>
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
