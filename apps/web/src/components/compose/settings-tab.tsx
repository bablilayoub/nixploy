"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";

export function SettingsTab({
	projectId,
	compose,
}: {
	projectId: string;
	compose: ComposeService;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();

	const [name, setName] = useState(compose.name);
	const [description, setDescription] = useState(compose.description ?? "");
	useEffect(() => {
		setName(compose.name);
		setDescription(compose.description ?? "");
	}, [compose.name, compose.description]);

	const updateMutation = useMutation(
		trpc.compose.update.mutationOptions({
			onSuccess: () => {
				toast.success("Compose service updated");
				queryClient.invalidateQueries({
					queryKey: trpc.compose.one.queryKey({ composeId: compose.composeId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const deleteMutation = useMutation(
		trpc.compose.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Compose service deleted");
				queryClient.invalidateQueries({
					queryKey: trpc.compose.all.queryKey(),
				});
				router.push(`/dashboard/projects/${projectId}`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Settings</CardTitle>
					<CardDescription>Rename or describe this compose service.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="max-w-sm"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Optional description"
							rows={3}
						/>
					</div>
					<div className="flex justify-end">
						<Button
							disabled={updateMutation.isPending || !name.trim()}
							onClick={() =>
								updateMutation.mutate({
									composeId: compose.composeId,
									name: name.trim(),
									description: description.trim() || null,
								})
							}
						>
							{updateMutation.isPending ? "Saving…" : "Save"}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card className="border-destructive/40">
				<CardHeader>
					<CardTitle className="text-sm font-medium text-destructive">Danger Zone</CardTitle>
					<CardDescription>
						Deleting a compose service tears down its deployment and removes its domains. This
						cannot be undone.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="destructive">Delete Compose Service</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Delete {compose.name}?</AlertDialogTitle>
								<AlertDialogDescription>
									This will stop the deployment, remove its Traefik configuration and permanently
									delete the service.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant="destructive"
									disabled={deleteMutation.isPending}
									onClick={() => deleteMutation.mutate({ composeId: compose.composeId })}
								>
									{deleteMutation.isPending ? "Deleting…" : "Delete"}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</CardContent>
			</Card>
		</div>
	);
}
