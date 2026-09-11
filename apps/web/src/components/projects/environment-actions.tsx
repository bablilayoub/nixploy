"use client";

import {
	Copy,
	CopyPlus,
	Download,
	Loader2,
	MoreHorizontal,
	Pencil,
	Trash2,
	Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";
import { GitopsCard, type GitopsCardHandle } from "./gitops-card";
import { describeServiceCounts, type ServiceCounts } from "./service-summary";

export interface EnvironmentRow {
	environmentId: string;
	name: string;
	description: string | null;
	/** Per-kind counts from `environment.byProject` — listed in the delete dialog. */
	services?: ServiceCounts;
}

/**
 * Manage the active environment: rename, duplicate (env vars are copied,
 * services are not) and delete (cascades to its services).
 */
export function EnvironmentActions({
	projectId,
	environment,
	isOnlyEnvironment,
	onRenamed,
	onDuplicated,
	onDeleted,
}: {
	projectId: string;
	environment: EnvironmentRow;
	isOnlyEnvironment: boolean;
	onRenamed: (name: string) => void;
	onDuplicated: (name: string) => void;
	onDeleted: () => void;
}) {
	const trpc = useTRPC();
	const router = useRouter();
	const { can } = useCapabilities();
	const canWrite = can("project.write");
	// Duplicate/clone copy env vars → the server also requires secrets.write.
	const canCopy = canWrite && can("secrets.write");
	const canDelete = can("project.delete");
	const canGitops = can("gitops.manage");

	const [renameOpen, setRenameOpen] = useState(false);
	const [duplicateOpen, setDuplicateOpen] = useState(false);
	const [cloneOpen, setCloneOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// Deleting cascades over every service, volume and domain in the
	// environment — the same type-the-name friction as a service delete.
	const [deleteConfirmation, setDeleteConfirmation] = useState("");
	const deleteConfirmed = deleteConfirmation === environment.name;
	const serviceSummary = environment.services ? describeServiceCounts(environment.services) : null;
	const [gitopsImportOpen, setGitopsImportOpen] = useState(false);
	const gitopsRef = useRef<GitopsCardHandle>(null);
	const [name, setName] = useState(environment.name);
	const [description, setDescription] = useState(environment.description ?? "");
	const [duplicateName, setDuplicateName] = useState(`${environment.name} copy`);
	const [cloneName, setCloneName] = useState(`${environment.name}-clone`);

	useEffect(() => {
		if (renameOpen) {
			setName(environment.name);
			setDescription(environment.description ?? "");
		}
	}, [renameOpen, environment.name, environment.description]);

	useEffect(() => {
		if (duplicateOpen) {
			setDuplicateName(`${environment.name} copy`);
		}
	}, [duplicateOpen, environment.name]);

	// This component is reused across environment switches (no key), so the
	// clone name must follow the active environment like the other dialogs.
	useEffect(() => {
		if (cloneOpen) {
			setCloneName(`${environment.name}-clone`);
		}
	}, [cloneOpen, environment.name]);

	// Every write here changes the environment list and both project views.
	const environmentKeys = [
		trpc.environment.byProject.queryKey({ projectId }),
		trpc.project.one.queryKey({ projectId }),
		trpc.project.all.queryKey(),
	];

	const rename = useSaveMutation(trpc.environment.update.mutationOptions(), {
		successMessage: "Environment updated",
		invalidate: environmentKeys,
		onSuccess: (updated) => {
			setRenameOpen(false);
			onRenamed(updated?.name ?? name.trim());
		},
	});
	const duplicate = useSaveMutation(
		trpc.environment.duplicate.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: (created) =>
				toast.success(`Environment "${created?.name ?? duplicateName.trim()}" created`),
		}),
		{
			invalidate: environmentKeys,
			onSuccess: (created) => {
				setDuplicateOpen(false);
				if (created?.name) {
					onDuplicated(created.name);
				}
			},
		},
	);
	const remove = useSaveMutation(
		trpc.environment.delete.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: () => toast.success(`Environment "${environment.name}" deleted`),
		}),
		{
			invalidate: environmentKeys,
			onSuccess: () => {
				setDeleteOpen(false);
				onDeleted();
			},
		},
	);
	const clone = useSaveMutation(
		trpc.environment.clone.mutationOptions({
			// Dynamic text plus a "View" action, so it stays here.
			onSuccess: (created) => {
				const clonedName = created?.name ?? cloneName.trim();
				toast.success(
					`Environment "${clonedName}" cloned with ${created?.servicesCloned ?? 0} services`,
					{
						action: {
							label: "View",
							onClick: () =>
								router.push(
									`/dashboard/projects/${projectId}?env=${encodeURIComponent(clonedName)}`,
								),
						},
					},
				);
			},
		}),
		{
			invalidate: environmentKeys,
			onSuccess: (created) => {
				setCloneOpen(false);
				if (created?.name) {
					onDuplicated(created.name);
				}
			},
		},
	);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="sm" aria-label="Environment actions">
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuItem
						disabled={!canWrite}
						title={canWrite ? undefined : capabilityHint("project.write")}
						onClick={() => setRenameOpen(true)}
					>
						<Pencil className="size-4" />
						Rename
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canCopy}
						title={canCopy ? undefined : capabilityHint("project.write", "secrets.write")}
						onClick={() => setDuplicateOpen(true)}
					>
						<Copy className="size-4" />
						Duplicate
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canCopy}
						title={canCopy ? undefined : capabilityHint("project.write", "secrets.write")}
						onClick={() => setCloneOpen(true)}
					>
						<CopyPlus className="size-4" />
						Clone with services
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						disabled={!canGitops}
						title={canGitops ? undefined : capabilityHint("gitops.manage")}
						onSelect={(event) => {
							event.preventDefault();
							void gitopsRef.current?.exportStack();
						}}
					>
						<Download className="size-4" />
						Export stack
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canGitops}
						title={canGitops ? undefined : capabilityHint("gitops.manage")}
						onSelect={() => setGitopsImportOpen(true)}
					>
						<Upload className="size-4" />
						Import stack
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						disabled={isOnlyEnvironment || !canDelete}
						title={
							!canDelete
								? capabilityHint("project.delete")
								: isOnlyEnvironment
									? "A project needs at least one environment"
									: undefined
						}
						onClick={() => setDeleteOpen(true)}
					>
						<Trash2 className="size-4" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<GitopsCard
				ref={gitopsRef}
				projectId={projectId}
				environmentName={environment.name}
				importOpen={gitopsImportOpen}
				onImportOpenChange={setGitopsImportOpen}
			/>

			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Rename environment</DialogTitle>
						<DialogDescription>
							Renaming updates the environment for all of its services.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							rename.mutate({
								environmentId: environment.environmentId,
								name: name.trim(),
								description: description.trim() || null,
							});
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="rename-environment-name">Name</Label>
							<Input
								id="rename-environment-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								autoFocus
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="rename-environment-description">Description</Label>
							<Textarea
								id="rename-environment-description"
								placeholder="Optional description"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								rows={3}
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={!name.trim() || rename.isPending}>
								{rename.isPending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Duplicate environment</DialogTitle>
						<DialogDescription>
							Copies the description and environment variables. Services are not copied.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							duplicate.mutate({
								environmentId: environment.environmentId,
								name: duplicateName.trim(),
							});
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="duplicate-environment-name">New name</Label>
							<Input
								id="duplicate-environment-name"
								value={duplicateName}
								onChange={(event) => setDuplicateName(event.target.value)}
								autoFocus
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={!duplicateName.trim() || duplicate.isPending}>
								{duplicate.isPending && <Loader2 className="size-4 animate-spin" />}
								Duplicate
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Clone environment with services</DialogTitle>
						<DialogDescription>
							Creates a new environment and duplicates every service into it (fresh appNames, no
							domains, nothing deployed yet).
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							clone.mutate({
								environmentId: environment.environmentId,
								name: cloneName.trim(),
							});
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="clone-environment-name">New name</Label>
							<Input
								id="clone-environment-name"
								value={cloneName}
								onChange={(event) => setCloneName(event.target.value)}
								autoFocus
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={!cloneName.trim() || clone.isPending}>
								{clone.isPending && <Loader2 className="size-4 animate-spin" />}
								Clone
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteOpen}
				onOpenChange={(next) => {
					setDeleteOpen(next);
					if (!next) setDeleteConfirmation("");
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete environment</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes "{environment.name}" and everything inside it. This action
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
						<li>{serviceSummary ?? "All services"}, including their containers and volumes</li>
						<li>Every domain, route and deployment history of those services</li>
						<li>The environment's own variables</li>
					</ul>
					<div className="space-y-1.5">
						<Label htmlFor="delete-environment-confirm">
							Type <span className="font-mono font-semibold">{environment.name}</span> to confirm
						</Label>
						<Input
							id="delete-environment-confirm"
							value={deleteConfirmation}
							onChange={(event) => setDeleteConfirmation(event.target.value)}
							placeholder={environment.name}
							autoComplete="off"
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={(event) => {
								// The cascade can take many seconds — keep the dialog (and its
								// spinner) open until onSuccess closes it.
								event.preventDefault();
								remove.mutate({ environmentId: environment.environmentId });
							}}
							disabled={!deleteConfirmed || remove.isPending}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete environment
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
