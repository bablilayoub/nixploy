"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

export function CreateProjectDialog({ children }: { children: React.ReactNode }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	// Deep link from the command palette (?new=project) opens the dialog once.
	useEffect(() => {
		if (searchParams.get("new") !== "project") {
			return;
		}
		setOpen(true);
		// Strip the param so a refresh doesn't reopen the dialog.
		const params = new URLSearchParams(searchParams.toString());
		params.delete("new");
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	}, [searchParams, router, pathname]);

	const createProject = useMutation(
		trpc.project.create.mutationOptions({
			onSuccess: async (project) => {
				toast.success(`Project "${project.name}" created`);
				await queryClient.invalidateQueries({
					queryKey: trpc.project.all.queryKey(),
				});
				setOpen(false);
				setName("");
				setDescription("");
			},
			onError: (error) => toastError(error),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
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
