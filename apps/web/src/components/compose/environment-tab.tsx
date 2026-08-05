"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { EnvEditor } from "@/components/services/env-editor";
import { useTRPC } from "@/lib/trpc";

export function EnvironmentTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const saveMutation = useMutation(
		trpc.compose.saveEnvironment.mutationOptions({
			onSuccess: () => {
				toast.success("Environment saved");
				queryClient.invalidateQueries({
					queryKey: trpc.compose.one.queryKey({ composeId: compose.composeId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<EnvEditor
			value={compose.env ?? ""}
			loading={saveMutation.isPending}
			onSave={(env) => saveMutation.mutate({ composeId: compose.composeId, env })}
		/>
	);
}
