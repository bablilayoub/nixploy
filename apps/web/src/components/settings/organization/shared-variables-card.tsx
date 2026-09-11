"use client";

import { useQuery } from "@tanstack/react-query";

import { SettingsSection } from "@/components/layout/settings-section";
import { EnvEditor } from "@/components/services/env-editor";
import { Button } from "@/components/ui/button";
import { HelpLink } from "@/components/ui/help-link";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useMounted } from "@/hooks/use-mounted";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";

const TITLE = "Shared variables";
const DESCRIPTION = (
	<>
		Inherited by every project, environment and service; lower levels override on key conflicts.{" "}
		<HelpLink slug="deploy" />
	</>
);

/** Organization-level env vars (the lowest level of the env inheritance chain). */
export function SharedVariablesCard() {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	// Keep the server-rendered skeleton until mount so both paints agree.
	const mounted = useMounted();

	const envQuery = useQuery(trpc.organization.environment.queryOptions());
	const canRead = can("secrets.read");
	const canManage = can("settings.manage");
	const canWriteSecrets = can("secrets.write");
	const canEdit = canManage && canWriteSecrets;

	const save = useSaveMutation(trpc.organization.saveEnvironment.mutationOptions(), {
		successMessage: "Shared variables saved",
		invalidate: [
			trpc.organization.environment.queryKey(),
			// Every resolved preview merges the org level in.
			trpc.project.getResolvedEnvironment.queryKey(),
		],
	});

	if (!mounted || envQuery.isPending) {
		return (
			<SettingsSection title={TITLE} description={DESCRIPTION}>
				<Skeleton className="h-40 w-full" />
			</SettingsSection>
		);
	}

	if (envQuery.isError) {
		return (
			<SettingsSection title={TITLE} description={DESCRIPTION}>
				<div className="flex flex-col items-center gap-2 py-8 text-center">
					<p className="text-sm font-medium">Could not load shared variables</p>
					<p className="text-sm text-muted-foreground">
						{envQuery.error.message || "Try again in a moment."}
					</p>
					<Button variant="outline" size="sm" onClick={() => void envQuery.refetch()}>
						Retry
					</Button>
				</div>
			</SettingsSection>
		);
	}

	return (
		<SettingsSection
			title={TITLE}
			description={
				<>
					{DESCRIPTION}
					{!canEdit && canRead ? (
						<> {missingCapabilityHint(canManage ? "secrets.write" : "settings.manage")} to edit.</>
					) : null}
				</>
			}
		>
			<EnvEditor
				value={envQuery.data.env}
				loading={save.isPending}
				canRead={canRead}
				canEdit={canEdit}
				downloadName="organization.env"
				onSave={(env) => save.mutateAsync({ env })}
			/>
		</SettingsSection>
	);
}
