"use client";

import { Loader2 } from "lucide-react";
import { SettingsSection } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { PreviewDatabaseFields } from "@/components/services/preview-database-fields";
import { PreviewDeploymentsPanel } from "@/components/services/preview-deployments-panel";
import { useSaveBar } from "@/components/services/save-bar";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

export function PreviewDeploymentsTab({ application }: { application: Application }) {
	return (
		<PreviewDeploymentsPanel
			target={{ applicationId: application.applicationId }}
			description="Per-PR preview instances. Enable under Source for git webhooks."
			createDescription="Spins up a variant of this application routed at a wildcard preview domain."
			settings={<PreviewSettingsCard application={application} />}
		/>
	);
}

/**
 * Preview knobs (product audit, Previews row): a preview-only env layer, the
 * per-application cap the webhook path enforces, and the default TTL stamped
 * on previews created by a pull request.
 */
function PreviewSettingsCard({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	// Background refetches must not wipe what is being typed.
	const draft = useDraft({
		previewEnv: application.previewEnv ?? "",
		limit: String(application.previewLimit ?? 3),
		ttlHours: application.previewTtlHours ? String(application.previewTtlHours) : "",
		databaseTarget:
			application.previewDatabaseKind && application.previewDatabaseId
				? `${application.previewDatabaseKind}:${application.previewDatabaseId}`
				: "",
		seedCommand: application.previewSeedCommand ?? "",
	});
	const { previewEnv, limit, ttlHours, databaseTarget, seedCommand } = draft.value;
	const [databaseKind, databaseId] = databaseTarget ? databaseTarget.split(":", 2) : [null, null];

	const update = useSaveMutation(trpc.application.update.mutationOptions(), {
		successMessage: "Preview settings saved",
		invalidate: [trpc.application.one.queryKey({ applicationId })],
		onSuccess: draft.markSaved,
	});

	const canWrite = can("service.write") && can("secrets.write");
	const parsedLimit = Number.parseInt(limit, 10);
	const parsedTtl = ttlHours.trim() ? Number.parseInt(ttlHours, 10) : null;
	const limitValid = Number.isFinite(parsedLimit) && parsedLimit >= 0 && parsedLimit <= 100;
	const ttlValid = parsedTtl === null || (Number.isFinite(parsedTtl) && parsedTtl >= 1);

	const onSave = () =>
		update.mutate({
			applicationId,
			previewEnv: previewEnv.trim() || null,
			previewLimit: parsedLimit,
			previewTtlHours: parsedTtl,
			previewDatabaseKind: (databaseKind ?? null) as
				| "postgres"
				| "mysql"
				| "mariadb"
				| "mongo"
				| null,
			previewDatabaseId: databaseId ?? null,
			previewSeedCommand: databaseKind ? seedCommand.trim() || null : null,
		});

	useSaveBar(draft, {
		onSave,
		pending: update.isPending,
		disabled: !canWrite || !limitValid || !ttlValid,
	});

	return (
		<SettingsSection
			title="Preview settings"
			description="Environment overrides, the cap on simultaneous previews, and how long a pull-request preview lives."
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="preview-env">Preview environment variables</Label>
					<Textarea
						id="preview-env"
						className="min-h-24 font-mono text-xs sm:max-w-lg"
						placeholder={"DATABASE_URL=postgres://preview\nSTRIPE_KEY=sk_test_..."}
						value={previewEnv}
						disabled={!canWrite}
						onChange={(event) => draft.patch({ previewEnv: event.target.value })}
					/>
					<p className="text-xs text-muted-foreground">
						Merged over the inherited project, environment and service variables for preview builds
						only — point a preview at a scratch database instead of production.
					</p>
				</div>

				<div className="grid gap-4 sm:max-w-lg sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<Label htmlFor="preview-limit">Maximum previews</Label>
						<Input
							id="preview-limit"
							inputMode="numeric"
							value={limit}
							disabled={!canWrite}
							onChange={(event) => draft.patch({ limit: event.target.value })}
						/>
						<p className="text-xs text-muted-foreground">0 means no limit.</p>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="preview-ttl">Expire after (hours)</Label>
						<Input
							id="preview-ttl"
							inputMode="numeric"
							placeholder="never"
							value={ttlHours}
							disabled={!canWrite}
							onChange={(event) => draft.patch({ ttlHours: event.target.value })}
						/>
						<p className="text-xs text-muted-foreground">
							Applied when a pull request creates the preview.
						</p>
					</div>
				</div>

				<PreviewDatabaseFields
					target={{ applicationId }}
					databaseTarget={databaseTarget}
					seedCommand={seedCommand}
					disabled={!canWrite}
					idPrefix="preview"
					onChange={(patch) => draft.patch(patch)}
				/>

				<div className="flex items-center justify-end gap-3">
					<UnsavedChangesPill dirty={draft.dirty} />
					<DisabledHint hint={canWrite ? undefined : capabilityHint("secrets.write")}>
						<Button
							disabled={!canWrite || !limitValid || !ttlValid || update.isPending}
							onClick={onSave}
						>
							{update.isPending && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
					</DisabledHint>
				</div>
			</div>
		</SettingsSection>
	);
}
