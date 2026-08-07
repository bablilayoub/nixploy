"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DangerZone } from "@/components/services/danger-zone";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
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
				</div>
			</SettingsSection>

			<DangerZone
				title="Delete application"
				description="Deleting an application removes its swarm service, routes, domains, mounts and deployment history. This action is irreversible."
				actionLabel="Delete Application"
				requireText={application.name}
				onConfirm={async () => {
					await remove.mutateAsync({ applicationId });
				}}
			/>
		</SettingsStack>
	);
}
