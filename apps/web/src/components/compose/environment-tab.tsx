"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ComposeService } from "@/components/compose/compose-detail";
import { EnvEditor } from "@/components/services/env-editor";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

export function EnvironmentTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();

	const saveMutation = useMutation(
		trpc.compose.saveEnvironment.mutationOptions({
			onSuccess: async () => {
				toast.success("Environment saved");
				await queryClient.invalidateQueries({
					queryKey: trpc.compose.one.queryKey({ composeId: compose.composeId }),
				});
			},
			onError: (error) => toastError(error),
		}),
	);

	return (
		<EnvEditor
			value={compose.env}
			loading={saveMutation.isPending}
			// The server nulls `env` for members without secrets.read; the editor
			// cannot tell that apart from an unset env, so pass the capability.
			canRead={can("secrets.read")}
			canEdit={can("secrets.write")}
			onSave={(env) => saveMutation.mutateAsync({ composeId: compose.composeId, env })}
		/>
	);
}
