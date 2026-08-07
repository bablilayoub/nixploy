"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import { useTRPC } from "@/lib/trpc";

import { GitopsCard, type GitopsCardHandle } from "./gitops-card";

export interface EnvironmentRow {
	environmentId: string;
	name: string;
	description: string | null;
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
	const queryClient = useQueryClient();

	const [renameOpen, setRenameOpen] = useState(false);
	const [duplicateOpen, setDuplicateOpen] = useState(false);
	const [cloneOpen, setCloneOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
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

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: trpc.environment.byProject.queryKey({ projectId }),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.project.one.queryKey({ projectId }),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.project.all.queryKey(),
			}),
		]);

	const rename = useMutation(
		trpc.environment.update.mutationOptions({
			onSuccess: async (updated) => {
				toast.success("Environment updated");
				await invalidate();
				setRenameOpen(false);
				onRenamed(updated?.name ?? name.trim());
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const duplicate = useMutation(
		trpc.environment.duplicate.mutationOptions({
			onSuccess: async (created) => {
				toast.success(`Environment "${created?.name ?? duplicateName.trim()}" created`);
				await invalidate();
				setDuplicateOpen(false);
				if (created?.name) {
					onDuplicated(created.name);
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		trpc.environment.delete.mutationOptions({
			onSuccess: async () => {
				toast.success(`Environment "${environment.name}" deleted`);
				await invalidate();
				setDeleteOpen(false);
				onDeleted();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const clone = useMutation(
		trpc.environment.clone.mutationOptions({
			onSuccess: async (created) => {
				toast.success(
					`Environment "${created?.name ?? cloneName.trim()}" cloned with ${created?.servicesCloned ?? 0} services`,
				);
				await invalidate();
				setCloneOpen(false);
				if (created?.name) {
					onDuplicated(created.name);
				}
			},
			onError: (error) => toast.error(error.message),
		}),
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
					<DropdownMenuItem onClick={() => setRenameOpen(true)}>
						<Pencil className="size-4" />
						Rename
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setDuplicateOpen(true)}>
						<Copy className="size-4" />
						Duplicate
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setCloneOpen(true)}>
						<CopyPlus className="size-4" />
						Clone with services
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onSelect={(event) => {
							event.preventDefault();
							void gitopsRef.current?.exportStack();
						}}
					>
						<Download className="size-4" />
						Export stack
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setGitopsImportOpen(true)}>
						<Upload className="size-4" />
						Import stack
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						disabled={isOnlyEnvironment}
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

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete environment?</AlertDialogTitle>
						<AlertDialogDescription>
							Every service inside "{environment.name}" — applications, compose stacks, databases
							and their deployment history — will be permanently deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => remove.mutate({ environmentId: environment.environmentId })}
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
