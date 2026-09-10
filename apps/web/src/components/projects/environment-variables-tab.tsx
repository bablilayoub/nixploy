"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { EnvEditor } from "@/components/services/env-editor";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
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
	/** `null` when the server redacted it (member lacks secrets.read). */
	projectEnv?: string | null;
	environment?: EnvironmentInfo;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	// The server nulls env values for members without secrets.read; the editor
	// cannot tell that apart from an unset env, so the capability drives it.
	const canRead = can("secrets.read");
	const canEdit = can("secrets.write");

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
			>
				<EnvEditor
					value={projectEnv ?? ""}
					loading={saveProjectEnv.isPending}
					canRead={canRead}
					canEdit={canEdit}
					onSave={(env) => saveProjectEnv.mutateAsync({ projectId, env })}
				/>
			</SettingsSection>

			{environment && (
				<SettingsSection
					title={`Environment overrides — ${environment.name}`}
					description="Only apply to this environment. Override project variables on key conflicts."
				>
					<EnvEditor
						key={environment.environmentId}
						value={environment.env ?? ""}
						loading={saveEnvironmentEnv.isPending}
						canRead={canRead}
						canEdit={canEdit}
						onSave={(env) =>
							saveEnvironmentEnv.mutateAsync({
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
				>
					<QueryState
						isPending={resolvedQuery.isPending}
						isError={resolvedQuery.isError}
						error={resolvedQuery.error}
						onRetry={() => resolvedQuery.refetch()}
						skeleton={<Skeleton className="h-64 rounded-lg" />}
						isEmpty={false}
						empty={null}
					>
						<pre className="max-h-96 overflow-auto rounded-lg border border-border bg-card p-4 font-mono text-[13px] whitespace-pre-wrap text-foreground">
							{resolvedQuery.data?.env || "# No variables defined"}
						</pre>
					</QueryState>
				</SettingsSection>
			)}
		</SettingsStack>
	);
}
