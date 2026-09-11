"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { EnvEditor } from "@/components/services/env-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { parseEnvFile } from "@/lib/env-file";
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
	// Lowest level of the chain, edited under Settings → Organization.
	const orgEnvQuery = useQuery(trpc.organization.environment.queryOptions());
	const orgKeys = orgEnvQuery.data?.env ? parseEnvFile(orgEnvQuery.data.env) : [];

	// Every level feeds the merged preview, so each save refreshes it too.
	const resolvedKey = trpc.project.getResolvedEnvironment.queryKey();

	const saveProjectEnv = useSaveMutation(trpc.project.saveEnvironment.mutationOptions(), {
		successMessage: "Project variables saved",
		invalidate: [trpc.project.one.queryKey({ projectId }), resolvedKey],
	});

	const saveEnvironmentEnv = useSaveMutation(
		trpc.environment.saveEnvironment.mutationOptions({
			// Dynamic text, so it stays here instead of `successMessage`.
			onSuccess: () => toast.success(`Variables saved for "${environment?.name}"`),
		}),
		{ invalidate: [trpc.environment.byProject.queryKey({ projectId }), resolvedKey] },
	);

	return (
		<SettingsStack>
			<SettingsSection
				title={
					<span className="flex items-center gap-2">
						<Building2 className="size-4 text-muted-foreground" />
						Organization shared variables
					</span>
				}
				description="Inherited by every project, environment and service; lower levels override on key conflicts."
				actions={
					<Button asChild variant="outline" size="sm">
						<Link href="/dashboard/settings/organization">Edit in organization settings</Link>
					</Button>
				}
			>
				{orgEnvQuery.isPending ? (
					<Skeleton className="h-8 w-64" />
				) : orgEnvQuery.isError ? (
					<p className="text-sm text-muted-foreground">
						Could not load shared variables: {orgEnvQuery.error.message}
					</p>
				) : orgEnvQuery.data.redacted ? (
					<p className="text-sm text-muted-foreground">
						Values are hidden — viewing them requires the "secrets.read" capability.
					</p>
				) : orgKeys.length === 0 ? (
					<p className="text-sm text-muted-foreground">No shared variables defined.</p>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{orgKeys.map((entry) => (
							<code
								key={entry.key}
								className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs"
							>
								{entry.key}
							</code>
						))}
					</div>
				)}
			</SettingsSection>

			<SettingsSection
				title="Project variables"
				description="Shared by every environment in this project. Deeper levels override these values."
			>
				<EnvEditor
					value={projectEnv ?? ""}
					loading={saveProjectEnv.isPending}
					canRead={canRead}
					canEdit={canEdit}
					downloadName="project.env"
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
						downloadName={`${environment.name}.env`}
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
