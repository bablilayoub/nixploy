"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { Check, Copy, KeyRound, Loader2, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageHeader } from "@/components/shell";
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
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type SshKeyRow = inferRouterOutputs<AppRouter>["sshKey"]["all"][number];

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			aria-label={copied ? "Copied" : "Copy"}
			title="Copy"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				} catch {
					toast.error("Failed to copy to clipboard — select the text and copy it manually");
				}
			}}
		>
			{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
		</Button>
	);
}

export function SshKeysView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const { can } = useCapabilities();
	const canManage = can("ssh_keys.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("ssh_keys.manage");
	const [name, setName] = useState("");
	const [generated, setGenerated] = useState<{
		privateKey: string;
		publicKey: string;
	} | null>(null);

	const {
		data: sshKeys,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.sshKey.all.queryOptions());

	useEffect(() => {
		if (!open) {
			setName("");
			setGenerated(null);
		}
	}, [open]);

	const generateMutation = useMutation(
		trpc.sshKey.generate.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);

	const createMutation = useMutation(
		trpc.sshKey.create.mutationOptions({
			onSuccess: async () => {
				toast.success("SSH key saved");
				await queryClient.invalidateQueries({
					queryKey: trpc.sshKey.all.queryKey(),
				});
				setOpen(false);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const removeMutation = useMutation(
		trpc.sshKey.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("SSH key removed");
				await queryClient.invalidateQueries({
					queryKey: trpc.sshKey.all.queryKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const [editing, setEditing] = useState<SshKeyRow | null>(null);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");

	useEffect(() => {
		if (editing) {
			setEditName(editing.name);
			setEditDescription(editing.description ?? "");
		}
	}, [editing]);

	const updateMutation = useMutation(
		trpc.sshKey.update.mutationOptions({
			onSuccess: async () => {
				toast.success("SSH key updated");
				await queryClient.invalidateQueries({
					queryKey: trpc.sshKey.all.queryKey(),
				});
				setEditing(null);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-col gap-8">
			<PageHeader title="SSH Keys" description="Keypairs used to connect to remote servers." />
			<SettingsSection
				title="SSH keys"
				description="Keypairs used to connect to remote servers."
				actions={
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm" disabled={!canManage} title={manageHint}>
								<Plus className="size-4" />
								Create SSH Key
							</Button>
						</DialogTrigger>
						<DialogContent className="max-w-2xl">
							<DialogHeader>
								<DialogTitle>Create SSH key</DialogTitle>
								<DialogDescription>
									{generated
										? "Copy the private key now — it will not be shown again. Save to store it (encrypted) in Nixploy."
										: "Generate a fresh ed25519 keypair."}
								</DialogDescription>
							</DialogHeader>
							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label htmlFor="ssh-key-name">Name</Label>
									<Input
										id="ssh-key-name"
										placeholder="e.g. deploy-key"
										value={name}
										onChange={(e) => setName(e.target.value)}
									/>
								</div>
								{generated && (
									<>
										<div className="grid gap-2">
											<div className="flex items-center justify-between">
												<Label>Private key</Label>
												<CopyButton value={generated.privateKey} />
											</div>
											<Textarea
												readOnly
												className="h-32 font-mono text-xs"
												value={generated.privateKey}
											/>
										</div>
										<div className="grid gap-2">
											<div className="flex items-center justify-between">
												<Label>Public key</Label>
												<CopyButton value={generated.publicKey} />
											</div>
											<Textarea
												readOnly
												className="h-20 font-mono text-xs"
												value={generated.publicKey}
											/>
										</div>
									</>
								)}
							</div>
							<DialogFooter>
								{generated ? (
									<Button
										disabled={createMutation.isPending}
										onClick={() =>
											createMutation.mutate({
												name,
												privateKey: generated.privateKey,
												publicKey: generated.publicKey,
											})
										}
									>
										{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
										Save key
									</Button>
								) : (
									<Button
										disabled={generateMutation.isPending || !name}
										onClick={() =>
											generateMutation.mutate({ name }, { onSuccess: (data) => setGenerated(data) })
										}
									>
										{generateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
										Generate keypair
									</Button>
								)}
							</DialogFooter>
						</DialogContent>
					</Dialog>
				}
			>
				<QueryState
					isPending={isPending}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!sshKeys || sshKeys.length === 0}
					skeleton={
						<div className="grid gap-2">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					}
					empty={
						<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
							<KeyRound className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								No SSH keys yet. Generate one to connect remote servers.
							</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Public key</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="w-12" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{(sshKeys ?? []).map((key) => (
								<TableRow key={key.sshKeyId}>
									<TableCell>
										<div className="grid">
											<span className="font-medium">{key.name}</span>
											{key.description && (
												<span className="text-xs text-muted-foreground">{key.description}</span>
											)}
										</div>
									</TableCell>
									<TableCell>
										<code className="block max-w-xs truncate text-xs text-muted-foreground">
											{key.publicKey}
										</code>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{format(new Date(key.createdAt), "MMM d, yyyy")}
									</TableCell>
									<TableCell>
										<div className="flex items-center justify-end">
											<Button
												variant="ghost"
												size="icon"
												disabled={!canManage}
												title={manageHint}
												onClick={() => setEditing(key)}
											>
												<Pencil className="size-4" />
												<span className="sr-only">Edit SSH key</span>
											</Button>
											<ConfirmDeleteDialog
												title="Delete SSH key"
												description={`Delete "${key.name}"? Servers referencing it keep working until edited.`}
												disabled={!canManage}
												disabledReason={manageHint}
												onConfirm={() => removeMutation.mutateAsync({ sshKeyId: key.sshKeyId })}
											/>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueryState>
			</SettingsSection>
			<Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit SSH key</DialogTitle>
						<DialogDescription>
							Key material is immutable; only name and description can change.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (editing) {
								updateMutation.mutate({
									sshKeyId: editing.sshKeyId,
									name: editName.trim(),
									description: editDescription.trim() || null,
								});
							}
						}}
						className="grid gap-4"
					>
						<div className="grid gap-2">
							<Label htmlFor="edit-ssh-key-name">Name</Label>
							<Input
								id="edit-ssh-key-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-ssh-key-description">Description</Label>
							<Textarea
								id="edit-ssh-key-description"
								placeholder="Optional description"
								rows={3}
								value={editDescription}
								onChange={(e) => setEditDescription(e.target.value)}
							/>
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
