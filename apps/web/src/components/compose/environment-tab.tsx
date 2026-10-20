"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { ConfigurationRelease } from "@/components/services/configuration-release";
import { EnvEditor } from "@/components/services/env-editor";
import { InheritedEnv } from "@/components/services/inherited-env";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

export function EnvironmentTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const composeId = compose.composeId;
	const saveMutation = useSaveMutation(trpc.compose.saveEnvironment.mutationOptions(), {
		successMessage: "Variables saved as a draft",
		invalidate: [
			trpc.compose.one.queryKey({ composeId }),
			trpc.configurationRelease.review.queryKey(),
		],
	});

	return (
		<div className="flex flex-col gap-4">
			<EnvEditor
				value={compose.env}
				loading={saveMutation.isPending}
				// The server nulls `env` for members without secrets.read; the editor
				// cannot tell that apart from an unset env, so pass the capability.
				canRead={can("secrets.read")}
				canEdit={can("secrets.write")}
				footerHint="Saved variables reach the containers on the next deployment."
				onSave={(env) => saveMutation.mutateAsync({ composeId, env })}
			/>
			<ConfigurationRelease scope={{ kind: "compose", id: composeId }} />
			<InheritedEnv
				projectId={compose.environment.project.projectId}
				environmentName={compose.environment.name}
				ownEnv={compose.env}
			/>
		</div>
	);
}
