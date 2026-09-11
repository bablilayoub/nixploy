"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

/**
 * `?new=project` (from the command palette) opens the dialog once and strips
 * the param so a refresh does not reopen it. `useSearchParams` bails the whole
 * route out of static rendering unless it sits under its own Suspense
 * boundary, so it lives in this leaf rather than in the dialog (code-health
 * F13 — the other nine call sites were already wrapped).
 */
function NewProjectDeepLink({ onOpen }: { onOpen: () => void }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	useEffect(() => {
		if (searchParams.get("new") !== "project") return;
		onOpen();
		const params = new URLSearchParams(searchParams.toString());
		params.delete("new");
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
	}, [searchParams, router, pathname, onOpen]);

	return null;
}

export function CreateProjectDialog({ children }: { children: React.ReactNode }) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const createProject = useSaveMutation(
		trpc.project.create.mutationOptions({
			onSuccess: () => {
				setOpen(false);
				setName("");
				setDescription("");
			},
		}),
		{
			// Success text names the project, so it is toasted here rather than
			// through `successMessage`.
			invalidate: [trpc.project.all.queryKey()],
			onSuccess: (project) => {
				toast.success(`Project "${project.name}" created`);
			},
		},
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Suspense fallback={null}>
				<NewProjectDeepLink onOpen={() => setOpen(true)} />
			</Suspense>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Create project</DialogTitle>
					<DialogDescription>
						A project groups environments and services. A{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">production</code>{" "}
						environment is created automatically.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						createProject.mutate({
							name: name.trim(),
							description: description.trim() || undefined,
						});
					}}
					className="flex flex-col gap-4"
				>
					<div className="flex flex-col gap-2">
						<Label htmlFor="project-name">Name</Label>
						<Input
							id="project-name"
							placeholder="my-saas"
							value={name}
							onChange={(event) => setName(event.target.value)}
							autoFocus
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="project-description">Description</Label>
						<Textarea
							id="project-description"
							placeholder="Optional description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							rows={3}
						/>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={!name.trim() || createProject.isPending}>
							{createProject.isPending ? "Creating..." : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
