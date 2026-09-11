"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { ServiceSettingsBody } from "@/components/services/service-settings-body";
import { useSaveMutation } from "@/hooks/use-save-mutation";
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

	const update = useSaveMutation(trpc.application.update.mutationOptions(), {
		successMessage: "Application updated",
		invalidate: [trpc.application.one.queryKey({ applicationId }), trpc.application.all.queryKey()],
	});

	const remove = useSaveMutation(
		trpc.application.delete.mutationOptions({
			onSuccess: () => router.push(`/dashboard/projects/${projectId}`),
		}),
		{ successMessage: "Application deleted", invalidate: [trpc.application.all.queryKey()] },
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

	return (
		<ServiceSettingsBody
			kind="application"
			name={application.name}
			description={application.description}
			projectId={projectId}
			environmentId={application.environmentId}
			ops={{
				save: (input) => update.mutate({ applicationId, ...input }),
				savePending: update.isPending,
				duplicate: async (environmentId) => {
					const created = await duplicate.mutateAsync({ applicationId, environmentId });
					return created.applicationId;
				},
				rename: (id, name) => rename.mutateAsync({ applicationId: id, name }),
				move: (environmentId) => move.mutateAsync({ applicationId, environmentId }),
				remove: () => remove.mutateAsync({ applicationId }),
			}}
		/>
	);
}
