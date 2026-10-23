"use client";

import { useQuery } from "@tanstack/react-query";
import { HardDrive, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { Mount } from "./types";

type MountType = Mount["type"];

const EMPTY_FORM = {
	type: "volume" as MountType,
	mountPath: "",
	hostPath: "",
	volumeName: "",
	filePath: "",
	content: "",
	serviceName: "",
};

/**
 * Which service owns the mounts. A compose stack also has to say which of its
 * containers a mount goes in, so it passes the service names of the rendered
 * file; an application has exactly one container and passes none.
 */
export type MountTarget =
	| { kind: "application"; applicationId: string }
	| { kind: "compose"; composeId: string; serviceNames: readonly string[] };

export function MountsManager({ target }: { target: MountTarget }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const writeHint = canWrite ? undefined : capabilityHint("service.write");

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<Mount | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [deleteTarget, setDeleteTarget] = useState<Mount | null>(null);

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm(EMPTY_FORM);
		}
	}, [dialogOpen]);

	const isCompose = target.kind === "compose";
	const listOptions = isCompose
		? trpc.mount.byCompose.queryOptions({ composeId: target.composeId })
		: trpc.mount.byApplication.queryOptions({ applicationId: target.applicationId });
	const { data: mounts, isLoading, isError, error, refetch } = useQuery(listOptions);

	const invalidate = [
		isCompose
			? trpc.mount.byCompose.queryKey({ composeId: target.composeId })
			: trpc.mount.byApplication.queryKey({ applicationId: target.applicationId }),
	];

	const create = useSaveMutation(
		trpc.mount.create.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Mount created", invalidate },
	);
	const update = useSaveMutation(
		trpc.mount.update.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Mount updated", invalidate },
	);
	const remove = useSaveMutation(
		trpc.mount.delete.mutationOptions({ onSuccess: () => setDeleteTarget(null) }),
		{ successMessage: "Mount deleted", invalidate },
	);

	const isPending = create.isPending || update.isPending;

	const openEdit = (mount: Mount) => {
		setEditing(mount);
		setForm({
			type: mount.type,
			mountPath: mount.mountPath,
			hostPath: mount.hostPath ?? "",
			volumeName: mount.volumeName ?? "",
			filePath: mount.filePath ?? "",
			content: mount.content ?? "",
			serviceName: mount.serviceName ?? "",
		});
		setDialogOpen(true);
	};

	const onSubmit = () => {
		if (editing) {
			update.mutate({
				mountId: editing.mountId,
				type: form.type,
				mountPath: form.mountPath,
				hostPath: form.type === "bind" ? form.hostPath || null : null,
				volumeName: form.type === "volume" ? form.volumeName || null : null,
				filePath: form.type === "file" ? form.filePath || null : null,
				content: form.type === "file" ? form.content || null : null,
				...(isCompose ? { serviceName: form.serviceName } : {}),
			});
		} else {
			create.mutate({
				...(isCompose
					? { composeId: target.composeId, serviceName: form.serviceName }
					: { applicationId: target.applicationId }),
				type: form.type,
				mountPath: form.mountPath,
				hostPath: form.type === "bind" ? form.hostPath || null : null,
				volumeName: form.type === "volume" ? form.volumeName || null : null,
				filePath: form.type === "file" ? form.filePath || null : null,
				content: form.type === "file" ? form.content || null : null,
			});
		}
	};

	const isValid =
		form.mountPath.trim() !== "" &&
		(!isCompose || form.serviceName.trim() !== "") &&
		(form.type !== "bind" || form.hostPath.trim() !== "") &&
		(form.type !== "volume" || form.volumeName.trim() !== "") &&
		(form.type !== "file" || form.filePath.trim() !== "");

	const mountSource = (mount: Mount) =>
		mount.type === "bind"
			? mount.hostPath
			: mount.type === "volume"
				? mount.volumeName
				: mount.filePath;

	return (
		<>
			<SettingsSection
				wide
				title="Mounts"
				description="Persist data with volumes, bind host paths, or inject config files."
				actions={
					<Button
						size="sm"
						onClick={() => setDialogOpen(true)}
						disabled={!canWrite}
						title={writeHint}
					>
						<Plus className="size-4" />
						Add mount
					</Button>
				}
			>
				<QueryState
					isPending={isLoading}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!mounts || mounts.length === 0}
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
							<HardDrive className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">No mounts configured.</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Type</TableHead>
								<TableHead>Source</TableHead>
								<TableHead>Mount path</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(mounts ?? []).map((mount) => (
								<TableRow key={mount.mountId}>
									<TableCell>
										<span className="text-sm capitalize">{mount.type}</span>
									</TableCell>
									<TableCell className="font-mono text-xs">{mountSource(mount) ?? "—"}</TableCell>
									<TableCell className="font-mono text-xs">{mount.mountPath}</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit"
												disabled={!canWrite}
												title={writeHint}
												onClick={() => openEdit(mount)}
											>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete"
												disabled={!canWrite}
												title={writeHint}
												onClick={() => setDeleteTarget(mount)}
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
						<DialogTitle>{editing ? "Edit mount" : "Add mount"}</DialogTitle>
						<DialogDescription>
							{isCompose
								? "Mounts are written into the rendered compose file on the next deploy."
								: "Mounts are applied to the service on the next update."}
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							onSubmit();
						}}
						className="flex flex-col gap-4"
					>
						{isCompose && (
							<div className="flex flex-col gap-2">
								<Label>Service</Label>
								<Select
									value={form.serviceName}
									onValueChange={(v) => setForm((f) => ({ ...f, serviceName: v }))}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Pick a service of the stack" />
									</SelectTrigger>
									<SelectContent>
										{target.serviceNames.map((name) => (
											<SelectItem key={name} value={name}>
												{name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									A stack has more than one container, so a mount has to name the one it goes in.
								</p>
							</div>
						)}
						<div className="flex flex-col gap-2">
							<Label>Type</Label>
							<Select
								value={form.type}
								onValueChange={(v) => setForm((f) => ({ ...f, type: v as MountType }))}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="volume">Volume</SelectItem>
									<SelectItem value="bind">Bind</SelectItem>
									<SelectItem value="file">File</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{form.type === "volume" && (
							<div className="flex flex-col gap-2">
								<Label htmlFor="volume-name">Volume name</Label>
								<Input
									id="volume-name"
									placeholder="{appName}-data"
									value={form.volumeName}
									onChange={(e) => setForm((f) => ({ ...f, volumeName: e.target.value }))}
								/>
							</div>
						)}
						{form.type === "bind" && (
							<div className="flex flex-col gap-2">
								<Label htmlFor="host-path">Host path</Label>
								<Input
									id="host-path"
									placeholder="/srv/data"
									value={form.hostPath}
									onChange={(e) => setForm((f) => ({ ...f, hostPath: e.target.value }))}
								/>
							</div>
						)}
						{form.type === "file" && (
							<>
								<div className="flex flex-col gap-2">
									<Label htmlFor="file-path">File path</Label>
									<Input
										id="file-path"
										placeholder="nginx.conf"
										value={form.filePath}
										onChange={(e) => setForm((f) => ({ ...f, filePath: e.target.value }))}
									/>
									<p className="text-xs text-muted-foreground">
										Relative to the application&apos;s files directory.
									</p>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="file-content">Content</Label>
									<Textarea
										id="file-content"
										className="min-h-32 font-mono text-sm"
										placeholder="File contents…"
										value={form.content}
										onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
									/>
								</div>
							</>
						)}

						<div className="flex flex-col gap-2">
							<Label htmlFor="mount-path">Mount Path (inside container)</Label>
							<Input
								id="mount-path"
								placeholder="/data"
								value={form.mountPath}
								onChange={(e) => setForm((f) => ({ ...f, mountPath: e.target.value }))}
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
						<AlertDialogTitle>Delete mount?</AlertDialogTitle>
						<AlertDialogDescription>
							The mount at <code className="rounded bg-muted px-1">{deleteTarget?.mountPath}</code>{" "}
							will be removed from the service. Data inside docker volumes is kept.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleteTarget) remove.mutate({ mountId: deleteTarget.mountId });
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
