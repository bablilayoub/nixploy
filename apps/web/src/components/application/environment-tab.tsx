"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { EnvEditor } from "@/components/services/env-editor";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

export function EnvironmentTab({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const applicationId = application.applicationId;

	const saveEnvironment = useMutation(
		trpc.application.saveEnvironment.mutationOptions({
			onSuccess: () => {
				toast.success("Environment variables saved");
				queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<EnvEditor
			value={application.env ?? ""}
			loading={saveEnvironment.isPending}
			onSave={(env) => saveEnvironment.mutate({ applicationId, env })}
		/>
	);
}
