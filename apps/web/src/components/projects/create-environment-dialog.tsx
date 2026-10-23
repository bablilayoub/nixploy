"use client";

import { useState } from "react";
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

export function CreateEnvironmentDialog({
	projectId,
	children,
	onCreated,
}: {
	projectId: string;
	children: React.ReactNode;
	onCreated?: (name: string) => void;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const createEnvironment = useSaveMutation(
		trpc.environment.create.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: (environment) => toast.success(`Environment "${environment.name}" created`),
		}),
		{
			invalidate: [trpc.environment.byProject.queryKey({ projectId }), trpc.project.all.queryKey()],
			onSuccess: (environment) => {
				setOpen(false);
				setName("");
				setDescription("");
				onCreated?.(environment.name);
			},
		},
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Create environment</DialogTitle>
					<DialogDescription>
						Environments isolate services inside a project (e.g. staging, production).
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						createEnvironment.mutate({
							projectId,
							name: name.trim(),
							description: description.trim() || undefined,
						});
					}}
					className="flex flex-col gap-4"
				>
					<div className="flex flex-col gap-2">
						<Label htmlFor="environment-name">Name</Label>
						<Input
							id="environment-name"
							placeholder="staging"
							value={name}
							onChange={(event) => setName(event.target.value)}
							autoFocus
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="environment-description">Description</Label>
						<Textarea
							id="environment-description"
							placeholder="Optional description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							rows={3}
						/>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={!name.trim() || createEnvironment.isPending}>
							{createEnvironment.isPending ? "Creating..." : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
