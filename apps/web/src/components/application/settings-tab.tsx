"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

export function SettingsTab({
	application,
	projectId,
}: {
	application: Application;
	projectId: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const applicationId = application.applicationId;

	const [name, setName] = useState(application.name);
	const [description, setDescription] = useState(application.description ?? "");
	const [deleteOpen, setDeleteOpen] = useState(false);

	useEffect(() => {
		setName(application.name);
		setDescription(application.description ?? "");
	}, [application]);

	const update = useMutation(
		trpc.application.update.mutationOptions({
			onSuccess: () => {
				toast.success("Application updated");
				queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
				queryClient.invalidateQueries({
					queryKey: trpc.application.all.queryKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const remove = useMutation(
		trpc.application.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Application deleted");
				queryClient.invalidateQueries({
					queryKey: trpc.application.all.queryKey(),
				});
				router.push(`/dashboard/projects/${projectId}`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">General</CardTitle>
					<CardDescription>Rename the application or change its description.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="app-name">Name</Label>
						<Input
							id="app-name"
							className="sm:max-w-sm"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="app-description">Description</Label>
						<Textarea
							id="app-description"
							className="min-h-20 sm:max-w-lg"
							placeholder="What does this application do?"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>
					<div className="flex justify-end">
						<Button
							onClick={() =>
								update.mutate({
									applicationId,
									name: name.trim(),
									description: description.trim() || null,
								})
							}
							disabled={!name.trim() || update.isPending}
						>
							{update.isPending && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card className="border-destructive/50">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-sm font-medium text-destructive">
						<TriangleAlert className="size-4" />
						Danger Zone
					</CardTitle>
					<CardDescription>
						Deleting an application removes its swarm service, routes, domains, mounts and
						deployment history. This action is irreversible.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button variant="destructive" onClick={() => setDeleteOpen(true)}>
						<Trash2 className="size-4" />
						Delete Application
					</Button>
				</CardContent>
			</Card>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {application.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes the application{" "}
							<span className="font-medium">{application.name}</span> (
							<code className="rounded bg-muted px-1">{application.appName}</code>), stops its
							containers and removes its routing configuration. This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => remove.mutate({ applicationId })}
							disabled={remove.isPending}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete Application
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
