"use client";

import { ConfigurationRelease } from "@/components/services/configuration-release";
import { EnvEditor } from "@/components/services/env-editor";
import { InheritedEnv } from "@/components/services/inherited-env";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

export function EnvironmentTab({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;
	const saveEnvironment = useSaveMutation(trpc.application.saveEnvironment.mutationOptions(), {
		successMessage: "Variables saved as a draft",
		invalidate: [
			trpc.application.one.queryKey({ applicationId }),
			trpc.configurationRelease.review.queryKey(),
		],
	});

	return (
		<div className="flex min-w-0 flex-col gap-5">
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
			<ConfigurationRelease scope={{ kind: "application", id: applicationId }} />
			<InheritedEnv
				projectId={application.environment.project.projectId}
				environmentName={application.environment.name}
				ownEnv={application.env}
			/>
		</div>
	);
}
