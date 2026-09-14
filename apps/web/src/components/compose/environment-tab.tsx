"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { EnvEditor } from "@/components/services/env-editor";
import { InheritedEnv } from "@/components/services/inherited-env";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useFollowDeployment } from "@/hooks/use-running-deployments";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

export function EnvironmentTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const composeId = compose.composeId;
	const followDeployment = useFollowDeployment();
	const canDeploy = can("service.deploy") && compose.readiness.canDeploy;

	const deploy = useMutation(
		trpc.compose.deploy.mutationOptions({
			onSuccess: (result) => followDeployment(result.deploymentId),
			onError: (error) => toastError(error),
		}),
	);

	// Same as applications: the stack keeps running with the old environment
	// until it is deployed again.
	const saveMutation = useSaveMutation(trpc.compose.saveEnvironment.mutationOptions(), {
		invalidate: [trpc.compose.one.queryKey({ composeId })],
		onSuccess: () => {
			toast.success("Environment saved", {
				description: canDeploy ? "It applies on the next deployment." : undefined,
				action: canDeploy
					? { label: "Deploy", onClick: () => deploy.mutate({ composeId }) }
					: undefined,
			});
		},
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
			<InheritedEnv
				projectId={compose.environment.project.projectId}
				environmentName={compose.environment.name}
				ownEnv={compose.env}
			/>
		</div>
	);
}
