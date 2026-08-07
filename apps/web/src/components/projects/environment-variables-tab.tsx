"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EnvEditor } from "@/components/services/env-editor";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

interface EnvironmentInfo {
	environmentId: string;
	name: string;
	env?: string | null;
}

/**
 * Project-level and per-environment env var editors plus a read-only
 * resolved (merged) preview: organization → project → environment.
 */
export function EnvironmentVariablesTab({
	projectId,
	projectEnv,
	environment,
}: {
	projectId: string;
	projectEnv?: string | null;
	environment?: EnvironmentInfo;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const resolvedQuery = useQuery({
		...trpc.project.getResolvedEnvironment.queryOptions({
			projectId,
			environmentName: environment?.name ?? "production",
		}),
		enabled: Boolean(environment),
	});

	const invalidateResolved = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.project.getResolvedEnvironment.queryKey(),
		});

	const saveProjectEnv = useMutation(
		trpc.project.saveEnvironment.mutationOptions({
			onSuccess: async () => {
				toast.success("Project variables saved");
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.project.one.queryKey({ projectId }),
					}),
					invalidateResolved(),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const saveEnvironmentEnv = useMutation(
		trpc.environment.saveEnvironment.mutationOptions({
			onSuccess: async () => {
				toast.success(`Variables saved for "${environment?.name}"`);
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.environment.byProject.queryKey({ projectId }),
					}),
					invalidateResolved(),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<SettingsStack>
			<SettingsSection
				title="Project variables"
				description="Shared by every environment in this project. Deeper levels override these values."
				wide
			>
				<EnvEditor
					value={projectEnv ?? ""}
					loading={saveProjectEnv.isPending}
					onSave={(env) => saveProjectEnv.mutate({ projectId, env })}
				/>
			</SettingsSection>

			{environment && (
				<SettingsSection
					title={`Environment overrides — ${environment.name}`}
					description="Only apply to this environment. Override project variables on key conflicts."
					wide
				>
					<EnvEditor
						key={environment.environmentId}
						value={environment.env ?? ""}
						loading={saveEnvironmentEnv.isPending}
						onSave={(env) =>
							saveEnvironmentEnv.mutate({
								environmentId: environment.environmentId,
								env,
							})
						}
					/>
				</SettingsSection>
			)}

			{environment && (
				<SettingsSection
					title="Resolved preview"
					description={`Effective variables for "${environment.name}" after merging organization, project and environment levels. Read-only.`}
					wide
				>
					{resolvedQuery.isPending ? (
						<Skeleton className="h-64 rounded-lg" />
					) : (
						<pre className="max-h-96 overflow-auto rounded-lg border border-border bg-card p-4 font-mono text-[13px] whitespace-pre-wrap text-foreground">
							{resolvedQuery.data?.env || "# No variables defined"}
						</pre>
					)}
				</SettingsSection>
			)}
		</SettingsStack>
	);
}
