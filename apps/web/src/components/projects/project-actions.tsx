"use client";

import { Loader2, Pencil, Settings2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

import { describeServiceCounts, type ServiceCounts, sumServiceCounts } from "./service-summary";

export function ProjectActions({
	project,
}: {
	project: {
		projectId: string;
		name: string;
		description: string | null;
		/** `project.one` environments — used to list what a delete removes. */
		environments?: Array<{
			name: string;
			services: { [K in keyof ServiceCounts]: unknown[] | number };
		}>;
	};
}) {
	const trpc = useTRPC();
	const router = useRouter();
	const { can } = useCapabilities();
	const canWrite = can("project.write");
	const canDelete = can("project.delete");
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// Deleting cascades over every environment, service, volume and domain —
	// the same type-the-name friction as a single service delete (DangerZone).
	const [confirmation, setConfirmation] = useState("");
	const deleteConfirmed = confirmation === project.name;
	const environmentCount = project.environments?.length ?? 0;
	const serviceSummary = project.environments
		? describeServiceCounts(sumServiceCounts(project.environments))
		: null;
	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description ?? "");

	const updateProject = useSaveMutation(trpc.project.update.mutationOptions(), {
		successMessage: "Project updated",
		invalidate: [
			trpc.project.all.queryKey(),
			trpc.project.one.queryKey({ projectId: project.projectId }),
		],
		onSuccess: () => setRenameOpen(false),
	});

	const deleteProject = useSaveMutation(
		trpc.project.delete.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: () => toast.success(`Project "${project.name}" deleted`),
		}),
		{
			invalidate: [trpc.project.all.queryKey()],
			onSuccess: () => router.push("/dashboard"),
		},
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
						disabled={!canWrite}
						title={canWrite ? undefined : capabilityHint("project.write")}
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
					<DropdownMenuItem
						variant="destructive"
						disabled={!canDelete}
						title={canDelete ? undefined : capabilityHint("project.delete")}
						onSelect={() => setDeleteOpen(true)}
					>
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

			<AlertDialog
				open={deleteOpen}
				onOpenChange={(next) => {
					setDeleteOpen(next);
					if (!next) setConfirmation("");
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete project</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes "{project.name}" and everything inside it. This action cannot
							be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
						<li>
							{environmentCount > 0
								? `${environmentCount} environment${environmentCount === 1 ? "" : "s"} (${project.environments
										?.map((environment) => environment.name)
										.join(", ")})`
								: "All environments"}
						</li>
						<li>{serviceSummary ?? "All services"}, including their containers and volumes</li>
						<li>Every domain, route and deployment history of those services</li>
					</ul>
					<div className="space-y-1.5">
						<Label htmlFor="delete-project-confirm">
							Type <span className="font-mono font-semibold">{project.name}</span> to confirm
						</Label>
						<Input
							id="delete-project-confirm"
							value={confirmation}
							onChange={(event) => setConfirmation(event.target.value)}
							placeholder={project.name}
							autoComplete="off"
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteProject.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={!deleteConfirmed || deleteProject.isPending}
							onClick={(event) => {
								// The cascade can take many seconds — keep the dialog (and its
								// spinner) open until the mutation settles.
								event.preventDefault();
								deleteProject.mutate({ projectId: project.projectId });
							}}
						>
							{deleteProject.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete project
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
