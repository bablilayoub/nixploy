"use client";

import { useQueryClient } from "@tanstack/react-query";
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
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const projectsKey = trpc.project.all.queryKey();

	const createProject = useSaveMutation(
		trpc.project.create.mutationOptions({
			onSuccess: () => {
				setOpen(false);
				setName("");
				setDescription("");
			},
		}),
		{
			// `invalidate` is deliberately NOT used here: the list has to be
			// refreshed by hand, see below.
			onSuccess: async (project) => {
				// Success text names the project, so it is toasted here rather than
				// through `successMessage`.
				toast.success(`Project "${project.name}" created`);

				// Whether the dashboard's `project.all` had ever resolved *before*
				// this write. It has not on the very first load of an empty
				// organization — the request that renders "Create your first
				// project" is still in flight while the user creates a project from
				// that same screen.
				const hadData = queryClient.getQueryData(projectsKey) !== undefined;
				await queryClient.invalidateQueries({ queryKey: projectsKey });
				// query-core only honours `cancelRefetch` once a query holds data
				// (`Query#fetch`: `state.data !== undefined && cancelRefetch`).
				// Without data it returns the promise of the request already in
				// flight instead, so the invalidation above resolves with the
				// PRE-CREATE list and the dashboard keeps rendering its empty state
				// until the next page load (2026-09 audit, ci2 §4.1 — reproduced by
				// holding the first `project.all` response until after the write).
				// One extra refetch, only in that case, guarantees a request that
				// started after the row existed.
				if (!hadData) {
					await queryClient.refetchQueries({ queryKey: projectsKey });
				}
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
