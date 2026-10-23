"use client";

import { Loader2 } from "lucide-react";

import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { DangerZone } from "@/components/services/danger-zone";
import { useSaveBar } from "@/components/services/save-bar";
import { ServiceActionsCard } from "@/components/services/service-actions-card";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";

/** Router-specific calls the shared body drives. */
export interface ServiceSettingsOps {
	/** Rename / re-describe. Must toast and invalidate itself (`useSaveMutation`). */
	save: (input: { name: string; description: string | null }) => void;
	savePending: boolean;
	/** Copy into `environmentId`, resolving to the new service id. */
	duplicate: (environmentId: string) => Promise<string>;
	/** Rename the freshly duplicated service (no toast). */
	rename: (serviceId: string, name: string) => Promise<unknown>;
	move: (environmentId: string) => Promise<unknown>;
	remove: () => Promise<unknown>;
}

const COPY = {
	application: {
		sectionTitle: "General",
		sectionDescription: "Rename the application or change its description.",
		descriptionPlaceholder: "What does this application do?",
		dangerTitle: "Delete application",
		dangerDescription:
			"Deleting an application removes its swarm service, routes, domains, mounts and deployment history. This action is irreversible.",
		dangerAction: "Delete application",
	},
	compose: {
		sectionTitle: "Settings",
		sectionDescription: "Rename or describe this compose service.",
		descriptionPlaceholder: "Optional description",
		dangerTitle: "Delete compose service",
		dangerDescription:
			"Deleting a compose service tears down its deployment and removes its domains. This cannot be undone.",
		dangerAction: "Delete compose service",
	},
} as const;

/**
 * Settings tab body shared by applications and compose stacks (code-health
 * F4: the two `settings-tab.tsx` files shared 71 of ~140 lines). Name +
 * description form, the duplicate/move card and the danger zone; the copy and
 * the router calls come from the caller.
 */
export function ServiceSettingsBody({
	kind,
	name,
	description,
	projectId,
	environmentId,
	ops,
}: {
	kind: "application" | "compose";
	name: string;
	description: string | null;
	projectId: string;
	environmentId: string;
	ops: ServiceSettingsOps;
}) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const canDelete = can("service.delete");
	const copy = COPY[kind];

	// Mirrors the server value while the user is not editing, so a background
	// refetch (deploy status flips, window focus) cannot wipe typed text.
	const draft = useDraft({ name, description: description ?? "" });
	const trimmedName = draft.value.name.trim();
	const onSave = () =>
		ops.save({ name: trimmedName, description: draft.value.description.trim() || null });
	useSaveBar(draft, {
		onSave,
		pending: ops.savePending,
		disabled: !canWrite || trimmedName === "",
	});

	return (
		<SettingsStack>
			<SettingsSection title={copy.sectionTitle} description={copy.sectionDescription}>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="service-name">Name</Label>
						<Input
							id="service-name"
							className="sm:max-w-sm"
							value={draft.value.name}
							onChange={(event) => draft.patch({ name: event.target.value })}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="service-description">Description</Label>
						<Textarea
							id="service-description"
							className="min-h-20 sm:max-w-lg"
							placeholder={copy.descriptionPlaceholder}
							value={draft.value.description}
							onChange={(event) => draft.patch({ description: event.target.value })}
						/>
					</div>
					<div className="flex items-center justify-end gap-3">
						<UnsavedChangesPill dirty={draft.dirty} />
						<DisabledHint hint={canWrite ? undefined : capabilityHint("service.write")}>
							<Button onClick={onSave} disabled={!trimmedName || ops.savePending || !canWrite}>
								{ops.savePending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
						</DisabledHint>
					</div>
				</div>
			</SettingsSection>

			<ServiceActionsCard
				kind={kind}
				serviceName={name}
				projectId={projectId}
				environmentId={environmentId}
				onDuplicate={ops.duplicate}
				onRename={ops.rename}
				onMove={ops.move}
			/>

			<DangerZone
				title={copy.dangerTitle}
				description={copy.dangerDescription}
				actionLabel={copy.dangerAction}
				requireText={name}
				disabled={!canDelete}
				disabledReason={capabilityHint("service.delete")}
				onConfirm={ops.remove}
			/>
		</SettingsStack>
	);
}
