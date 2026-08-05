"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Settings2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

export function ProjectActions({
	project,
}: {
	project: {
		projectId: string;
		name: string;
		description: string | null;
	};
}) {
	const trpc = useTRPC();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description ?? "");

	const invalidateProjects = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: trpc.project.all.queryKey(),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.project.one.queryKey({
					projectId: project.projectId,
				}),
			}),
		]);
	};

	const updateProject = useMutation(
		trpc.project.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Project updated");
				await invalidateProjects();
				setRenameOpen(false);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const deleteProject = useMutation(
		trpc.project.delete.mutationOptions({
			onSuccess: async () => {
				toast.success(`Project "${project.name}" deleted`);
				await queryClient.invalidateQueries({
					queryKey: trpc.project.all.queryKey(),
				});
				router.push("/dashboard");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="icon">
						<Settings2 className="size-4" />
						<span className="sr-only">Project settings</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onSelect={() => {
							setName(project.name);
							setDescription(project.description ?? "");
							setRenameOpen(true);
						}}
					>
						<Pencil className="size-4" />
						Rename
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
						<Trash2 className="size-4" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Rename project</DialogTitle>
						<DialogDescription>Update the name and description of this project.</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							updateProject.mutate({
								projectId: project.projectId,
								name: name.trim(),
								description: description.trim() || null,
							});
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="rename-project-name">Name</Label>
							<Input
								id="rename-project-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								autoFocus
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="rename-project-description">Description</Label>
							<Textarea
								id="rename-project-description"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								rows={3}
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={!name.trim() || updateProject.isPending}>
								{updateProject.isPending ? "Saving..." : "Save"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete project</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes "{project.name}", all of its environments and every service
							inside them. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteProject.isPending}
							onClick={(event) => {
								event.preventDefault();
								deleteProject.mutate({ projectId: project.projectId });
							}}
						>
							{deleteProject.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
