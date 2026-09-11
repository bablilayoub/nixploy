"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EnvEditor } from "@/components/services/env-editor";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";

const TITLE = "Shared variables";
const DESCRIPTION =
	"Inherited by every project, environment and service; lower levels override on key conflicts.";

/** Organization-level env vars (the lowest level of the env inheritance chain). */
export function SharedVariablesCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	// Keep the server-rendered skeleton until mount so both paints agree.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const envQuery = useQuery(trpc.organization.environment.queryOptions());
	const canRead = can("secrets.read");
	const canManage = can("settings.manage");
	const canWriteSecrets = can("secrets.write");
	const canEdit = canManage && canWriteSecrets;

	const save = useMutation(
		trpc.organization.saveEnvironment.mutationOptions({
			onSuccess: async () => {
				toast.success("Shared variables saved");
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: trpc.organization.environment.queryKey() }),
					// Every resolved preview merges the org level in.
					queryClient.invalidateQueries({
						queryKey: trpc.project.getResolvedEnvironment.queryKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

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
