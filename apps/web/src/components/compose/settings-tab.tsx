"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { DangerZone } from "@/components/services/danger-zone";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
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
		<SettingsStack>
			<SettingsSection title="Settings" description="Rename or describe this compose service.">
				<div className="flex flex-col gap-4">
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
				</div>
			</SettingsSection>

			<DangerZone
				title="Delete compose service"
				description="Deleting a compose service tears down its deployment and removes its domains. This cannot be undone."
				actionLabel="Delete Compose Service"
				requireText={compose.name}
				onConfirm={async () => {
					await deleteMutation.mutateAsync({ composeId: compose.composeId });
				}}
			/>
		</SettingsStack>
	);
}
