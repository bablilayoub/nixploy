"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { EnvEditor } from "@/components/services/env-editor";
import { InheritedEnv } from "@/components/services/inherited-env";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useFollowDeployment } from "@/hooks/use-running-deployments";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

export function EnvironmentTab({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;
	const followDeployment = useFollowDeployment();
	const canDeploy = can("service.deploy") && application.readiness.canDeploy;

	const deploy = useMutation(
		trpc.application.deploy.mutationOptions({
			onSuccess: (result) => followDeployment(result.deploymentId),
			onError: (error) => toastError(error),
		}),
	);

	// A saved variable reaches the container on the next rollout, not on save.
	// The toast says so and offers the rollout, instead of leaving the operator
	// to wonder why nothing changed.
	const saveEnvironment = useSaveMutation(trpc.application.saveEnvironment.mutationOptions(), {
		invalidate: [trpc.application.one.queryKey({ applicationId })],
		onSuccess: () => {
			toast.success("Environment variables saved", {
				description: canDeploy ? "They apply on the next deployment." : undefined,
				action: canDeploy
					? { label: "Deploy", onClick: () => deploy.mutate({ applicationId }) }
					: undefined,
			});
		},
	});

	return (
		<div className="flex flex-col gap-4">
			<EnvEditor
				value={application.env}
				loading={saveEnvironment.isPending}
				// The server nulls `env` for members without secrets.read; the editor
				// cannot tell that apart from an unset env, so pass the capability.
				canRead={can("secrets.read")}
				canEdit={can("secrets.write")}
				footerHint="Saved variables reach the container on the next deployment."
				onSave={(env) => saveEnvironment.mutateAsync({ applicationId, env })}
			/>
			<InheritedEnv
				projectId={application.environment.project.projectId}
				environmentName={application.environment.name}
				ownEnv={application.env}
			/>
		</div>
	);
}
