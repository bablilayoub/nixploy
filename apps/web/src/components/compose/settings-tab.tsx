"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import type { ComposeService } from "@/components/compose/compose-detail";
import { ServiceSettingsBody } from "@/components/services/service-settings-body";
import { useSaveMutation } from "@/hooks/use-save-mutation";
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
	const composeId = compose.composeId;

	const update = useSaveMutation(trpc.compose.update.mutationOptions(), {
		successMessage: "Compose service updated",
		invalidate: [trpc.compose.one.queryKey({ composeId }), trpc.compose.all.pathKey()],
	});

	const remove = useSaveMutation(
		trpc.compose.delete.mutationOptions({
			onSuccess: () => router.push(`/dashboard/projects/${projectId}`),
		}),
		{ successMessage: "Compose service deleted", invalidate: [trpc.compose.all.queryKey()] },
	);

	const duplicate = useMutation(trpc.compose.duplicate.mutationOptions());
	// Separate from `update`: renaming the copy must not toast.
	const rename = useMutation(trpc.compose.update.mutationOptions());
	const move = useMutation(
		trpc.compose.move.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: trpc.compose.one.queryKey({ composeId }) }),
		}),
	);

	return (
		<ServiceSettingsBody
			kind="compose"
			name={compose.name}
			description={compose.description}
			projectId={projectId}
			environmentId={compose.environmentId}
			ops={{
				save: (input) => update.mutate({ composeId, ...input }),
				savePending: update.isPending,
				duplicate: async (environmentId) => {
					const created = await duplicate.mutateAsync({ composeId, environmentId });
					return created.composeId;
				},
				rename: (id, name) => rename.mutateAsync({ composeId: id, name }),
				move: (environmentId) => move.mutateAsync({ composeId, environmentId }),
				remove: () => remove.mutateAsync({ composeId }),
			}}
		/>
	);
}
