"use client";

import { EnvEditor } from "@/components/services/env-editor";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

export function EnvironmentTab({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	const saveEnvironment = useSaveMutation(trpc.application.saveEnvironment.mutationOptions(), {
		successMessage: "Environment variables saved",
		invalidate: [trpc.application.one.queryKey({ applicationId })],
	});

	return (
		<EnvEditor
			value={application.env}
			loading={saveEnvironment.isPending}
			// The server nulls `env` for members without secrets.read; the editor
			// cannot tell that apart from an unset env, so pass the capability.
			canRead={can("secrets.read")}
			canEdit={can("secrets.write")}
			onSave={(env) => saveEnvironment.mutateAsync({ applicationId, env })}
		/>
	);
}
