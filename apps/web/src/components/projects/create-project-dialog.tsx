"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FolderGit2, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState } from "react";
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
import { describeError } from "@/lib/describe-error";
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

export function CreateProjectDialog({
	children,
	handleDeepLink = false,
}: {
	children: React.ReactNode;
	/** Only one instance on a page may consume ?new=project. */
	handleDeepLink?: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const id = useId();
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
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: projectsKey }),
					queryClient.invalidateQueries({ queryKey: trpc.project.overview.queryKey() }),
					queryClient.invalidateQueries({ queryKey: trpc.project.onboarding.queryKey() }),
				]);
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
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (createProject.isPending) return;
				setOpen(next);
				if (next) createProject.reset();
			}}
		>
			{handleDeepLink ? (
				<Suspense fallback={null}>
					<NewProjectDeepLink onOpen={() => setOpen(true)} />
				</Suspense>
			) : null}
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Create project</DialogTitle>
					<DialogDescription>
						Keep related applications, Compose stacks, and databases together.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (!name.trim() || createProject.isPending) return;
						createProject.mutate({
							name: name.trim(),
							description: description.trim() || undefined,
						});
					}}
					className="flex flex-col gap-5"
				>
					<div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
						<FolderGit2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<p className="leading-relaxed text-muted-foreground">
							Includes a <span className="font-medium text-foreground">production</span>{" "}
							environment. You can add staging or preview environments later.
						</p>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor={`${id}-name`}>Project name</Label>
						<Input
							id={`${id}-name`}
							placeholder="e.g. Customer portal"
							value={name}
							onChange={(event) => setName(event.target.value)}
							autoFocus
							autoComplete="off"
							maxLength={255}
							required
							disabled={createProject.isPending}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor={`${id}-description`}>
							Description <span className="font-normal text-muted-foreground">(optional)</span>
						</Label>
						<Textarea
							id={`${id}-description`}
							placeholder="What does this project run?"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							rows={3}
							disabled={createProject.isPending}
						/>
					</div>
					{createProject.isError ? (
						<p role="alert" className="text-sm text-destructive">
							{describeError(createProject.error, "Could not create the project. Try again.")}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={createProject.isPending}
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!name.trim() || createProject.isPending}>
							{createProject.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
							{createProject.isPending ? "Creating project…" : "Create project"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
