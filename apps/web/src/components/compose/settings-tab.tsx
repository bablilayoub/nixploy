"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { capabilityHint } from "@/components/services/capability-hint";
import { DangerZone } from "@/components/services/danger-zone";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
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
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const canDelete = can("service.delete");

	const [name, setName] = useState(compose.name);
	const [description, setDescription] = useState(compose.description ?? "");
	// Only mirror server values while the user is not editing.
	const [dirty, setDirty] = useState(false);
	useEffect(() => {
		if (dirty) return;
		setName(compose.name);
		setDescription(compose.description ?? "");
	}, [dirty, compose.name, compose.description]);

	const updateMutation = useMutation(
		trpc.compose.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Compose service updated");
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.compose.one.queryKey({ composeId: compose.composeId }),
					}),
					queryClient.invalidateQueries({ queryKey: trpc.compose.all.pathKey() }),
				]);
				setDirty(false);
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
							onChange={(e) => {
								setDirty(true);
								setName(e.target.value);
							}}
							className="max-w-sm"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							value={description}
							onChange={(e) => {
								setDirty(true);
								setDescription(e.target.value);
							}}
							placeholder="Optional description"
							rows={3}
						/>
					</div>
					<div className="flex items-center justify-end gap-3">
						<UnsavedChangesPill dirty={dirty} />
						<DisabledHint hint={canWrite ? undefined : capabilityHint("service.write")}>
							<Button
								disabled={updateMutation.isPending || !name.trim() || !canWrite}
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
						</DisabledHint>
					</div>
				</div>
			</SettingsSection>

			<DangerZone
				title="Delete compose service"
				description="Deleting a compose service tears down its deployment and removes its domains. This cannot be undone."
				actionLabel="Delete Compose Service"
				requireText={compose.name}
				disabled={!canDelete}
				disabledReason={capabilityHint("service.delete")}
				onConfirm={() => deleteMutation.mutateAsync({ composeId: compose.composeId })}
			/>
		</SettingsStack>
	);
}
