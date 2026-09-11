"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { EnvEditor } from "@/components/services/env-editor";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

export function EnvironmentTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();

	const saveMutation = useSaveMutation(trpc.compose.saveEnvironment.mutationOptions(), {
		successMessage: "Environment saved",
		invalidate: [trpc.compose.one.queryKey({ composeId: compose.composeId })],
	});

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
