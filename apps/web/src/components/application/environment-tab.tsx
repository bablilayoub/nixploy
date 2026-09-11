"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EnvEditor } from "@/components/services/env-editor";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

export function EnvironmentTab({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	const saveEnvironment = useMutation(
		trpc.application.saveEnvironment.mutationOptions({
			onSuccess: async () => {
				toast.success("Environment variables saved");
				await queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
			},
			onError: (error) => toastError(error),
		}),
	);

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
