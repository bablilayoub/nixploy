"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { TraefikParent } from "./traefik-parent";
import type { SecurityEntry } from "./types";

const EMPTY_FORM = { username: "", password: "" };

/**
 * HTTP basic auth for an application or for one service of a compose stack —
 * the same rows behind the same Traefik `basicAuth` middleware.
 */
export function SecurityManager(parent: TraefikParent) {
	const { applicationId, composeId, serviceName } = parent;
	const trpc = useTRPC();
	const { can } = useCapabilities();
	// Credentials are secrets: create/update need service.write + secrets.write.
	const canWrite = can("service.write") && can("secrets.write");
	const writeHint = canWrite ? undefined : capabilityHint("service.write", "secrets.write");
	const canDelete = can("service.write");
	const deleteHint = canDelete ? undefined : capabilityHint("service.write");

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<SecurityEntry | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [deleteTarget, setDeleteTarget] = useState<SecurityEntry | null>(null);

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm(EMPTY_FORM);
		}
	}, [dialogOpen]);

	const {
		data: entries,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(
		applicationId
			? trpc.security.byApplication.queryOptions({ applicationId })
			: trpc.security.byCompose.queryOptions({
					composeId: composeId as string,
					serviceName: serviceName as string,
				}),
	);

	const invalidate = [
		applicationId
			? trpc.security.byApplication.queryKey({ applicationId })
			: trpc.security.byCompose.queryKey({
					composeId: composeId as string,
					serviceName: serviceName as string,
				}),
	];

	const create = useSaveMutation(
		trpc.security.create.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Credentials created", invalidate },
	);
	const update = useSaveMutation(
		trpc.security.update.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Credentials updated", invalidate },
	);
	const remove = useSaveMutation(
		trpc.security.delete.mutationOptions({ onSuccess: () => setDeleteTarget(null) }),
		{ successMessage: "Credentials deleted", invalidate },
	);

	const isPending = create.isPending || update.isPending;
	const isValid = form.username.trim() !== "" && (editing !== null || form.password.trim() !== "");

	const openEdit = (entry: SecurityEntry) => {
		setEditing(entry);
		setForm({ username: entry.username, password: "" });
		setDialogOpen(true);
	};

	const onSubmit = () => {
		if (editing) {
			update.mutate({
				securityId: editing.securityId,
				username: form.username,
				...(form.password ? { password: form.password } : {}),
			});
		} else if (applicationId) {
			create.mutate({
				applicationId,
				username: form.username,
				password: form.password,
			});
		} else {
			create.mutate({
				composeId: composeId as string,
				serviceName,
				username: form.username,
				password: form.password,
			});
		}
	};

	return (
		<>
			<SettingsSection
				title="Security"
				description={
					serviceName
						? `Protect ${serviceName} with HTTP basic auth at the reverse proxy.`
						: "Protect the application with HTTP basic auth at the reverse proxy."
				}
				actions={
					<Button
						size="sm"
						onClick={() => setDialogOpen(true)}
						disabled={!canWrite}
						title={writeHint}
					>
						<Plus className="size-4" />
						Add credentials
					</Button>
				}
			>
				<QueryState
					isPending={isLoading}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!entries || entries.length === 0}
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
							<ShieldCheck className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								No basic-auth credentials. This service is publicly reachable.
							</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Username</TableHead>
								<TableHead>Password</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(entries ?? []).map((entry) => (
								<TableRow key={entry.securityId}>
									<TableCell className="font-medium">{entry.username}</TableCell>
									<TableCell className="text-muted-foreground">••••••••</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit"
												disabled={!canWrite}
												title={writeHint}
												onClick={() => openEdit(entry)}
											>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete"
												disabled={!canDelete}
												title={deleteHint}
												onClick={() => setDeleteTarget(entry)}
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
						<DialogTitle>{editing ? "Edit credentials" : "Add credentials"}</DialogTitle>
						<DialogDescription>
							{editing
								? "Leave the password empty to keep the current one."
								: "Visitors will be asked for these credentials before reaching the app."}
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							onSubmit();
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="username">Username</Label>
							<Input
								id="username"
								autoComplete="off"
								value={form.username}
								onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								autoComplete="new-password"
								value={form.password}
								onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
							/>
						</div>
						<DialogFooter>
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
						<AlertDialogTitle>Delete credentials?</AlertDialogTitle>
						<AlertDialogDescription>
							Basic-auth access for user{" "}
							<span className="font-medium">{deleteTarget?.username}</span> will be removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleteTarget) remove.mutate({ securityId: deleteTarget.securityId });
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
