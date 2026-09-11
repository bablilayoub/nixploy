"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { capabilityHint } from "@/components/services/capability-hint";
import { DangerZone } from "@/components/services/danger-zone";
import { ServiceActionsCard } from "@/components/services/service-actions-card";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
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
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	const [name, setName] = useState(application.name);
	const [description, setDescription] = useState(application.description ?? "");
	// Only mirror server values while the user is not editing — background
	// refetches (deploy status flips, window focus) must not wipe typed text.
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		if (dirty) return;
		setName(application.name);
		setDescription(application.description ?? "");
	}, [dirty, application.name, application.description]);

	const update = useMutation(
		trpc.application.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Application updated");
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.application.one.queryKey({ applicationId }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.application.all.queryKey(),
					}),
				]);
				// Refetch is done: the server now holds what was typed.
				setDirty(false);
			},
			onError: (error) => toastError(error),
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
			onError: (error) => toastError(error),
		}),
	);

	const duplicate = useMutation(trpc.application.duplicate.mutationOptions());
	// Separate from `update`: renaming the copy must not toast "Application updated".
	const rename = useMutation(trpc.application.update.mutationOptions());
	const move = useMutation(
		trpc.application.move.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				}),
		}),
	);

	const canWrite = can("service.write");
	const canDelete = can("service.delete");

	return (
		<SettingsStack>
			<SettingsSection
				title="General"
				description="Rename the application or change its description."
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="app-name">Name</Label>
						<Input
							id="app-name"
							className="sm:max-w-sm"
							value={name}
							onChange={(e) => {
								setDirty(true);
								setName(e.target.value);
							}}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="app-description">Description</Label>
						<Textarea
							id="app-description"
							className="min-h-20 sm:max-w-lg"
							placeholder="What does this application do?"
							value={description}
							onChange={(e) => {
								setDirty(true);
								setDescription(e.target.value);
							}}
						/>
					</div>
					<div className="flex items-center justify-end gap-3">
						<UnsavedChangesPill dirty={dirty} />
						<DisabledHint hint={canWrite ? undefined : capabilityHint("service.write")}>
							<Button
								onClick={() =>
									update.mutate({
										applicationId,
										name: name.trim(),
										description: description.trim() || null,
									})
								}
								disabled={!name.trim() || update.isPending || !canWrite}
							>
								{update.isPending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
						</DisabledHint>
					</div>
				</div>
			</SettingsSection>

			<ServiceActionsCard
				kind="application"
				serviceName={application.name}
				projectId={projectId}
				environmentId={application.environmentId}
				onDuplicate={async (environmentId) => {
					const created = await duplicate.mutateAsync({
						applicationId,
						environmentId,
					});
					return created.applicationId;
				}}
				onRename={(id, name) => rename.mutateAsync({ applicationId: id, name })}
				onMove={(environmentId) => move.mutateAsync({ applicationId, environmentId })}
			/>

			<DangerZone
				title="Delete application"
				description="Deleting an application removes its swarm service, routes, domains, mounts and deployment history. This action is irreversible."
				actionLabel="Delete Application"
				requireText={application.name}
				disabled={!canDelete}
				disabledReason={capabilityHint("service.delete")}
				onConfirm={() => remove.mutateAsync({ applicationId })}
			/>
		</SettingsStack>
	);
}
