"use client";

import { Loader2 } from "lucide-react";
import type { ComposeService } from "@/components/compose/compose-detail";
import { SettingsSection } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { PreviewDatabaseFields } from "@/components/services/preview-database-fields";
import { PreviewDeploymentsPanel } from "@/components/services/preview-deployments-panel";
import { useSaveBar } from "@/components/services/save-bar";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

const GIT_PROVIDER_SOURCES = ["github", "gitlab", "bitbucket", "gitea"] as const;

/** Only a provider-backed source receives pull-request webhooks. */
const hasPullRequests = (sourceType: ComposeService["sourceType"]): boolean =>
	(GIT_PROVIDER_SOURCES as readonly string[]).includes(sourceType);

export function PreviewDeploymentsTab({ compose }: { compose: ComposeService }) {
	return (
		<PreviewDeploymentsPanel
			target={{ composeId: compose.composeId }}
			description="Per-PR preview stacks. Each one deploys the whole compose project under its own name."
			createDescription="Spins up the whole compose project under a preview name, with a wildcard domain for every service that has one in production."
			settings={<PreviewSettingsCard compose={compose} />}
		/>
	);
}

/**
 * The same five knobs the application has, on one card: a compose service has
 * no separate Source tab section to hang the two switches off.
 */
function PreviewSettingsCard({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const composeId = compose.composeId;
	const gitBacked = hasPullRequests(compose.sourceType);

	// Background refetches must not wipe what is being typed.
	const draft = useDraft({
		enabled: compose.isPreviewDeploymentsActive,
		forkGate: compose.previewForksRequireApproval,
		previewEnv: compose.previewEnv ?? "",
		limit: String(compose.previewLimit ?? 3),
		ttlHours: compose.previewTtlHours ? String(compose.previewTtlHours) : "",
		databaseTarget:
			compose.previewDatabaseKind && compose.previewDatabaseId
				? `${compose.previewDatabaseKind}:${compose.previewDatabaseId}`
				: "",
		seedCommand: compose.previewSeedCommand ?? "",
	});
	const { enabled, forkGate, previewEnv, limit, ttlHours, databaseTarget, seedCommand } =
		draft.value;
	const [databaseKind, databaseId] = databaseTarget ? databaseTarget.split(":", 2) : [null, null];

	const update = useSaveMutation(trpc.compose.update.mutationOptions(), {
		successMessage: "Preview settings saved",
		invalidate: [trpc.compose.one.queryKey({ composeId })],
		onSuccess: draft.markSaved,
	});

	const canWrite = can("service.write") && can("secrets.write");
	const parsedLimit = Number.parseInt(limit, 10);
	const parsedTtl = ttlHours.trim() ? Number.parseInt(ttlHours, 10) : null;
	const limitValid = Number.isFinite(parsedLimit) && parsedLimit >= 0 && parsedLimit <= 100;
	const ttlValid = parsedTtl === null || (Number.isFinite(parsedTtl) && parsedTtl >= 1);

	const onSave = () =>
		update.mutate({
			composeId,
			isPreviewDeploymentsActive: enabled,
			previewForksRequireApproval: forkGate,
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
			description="Pull-request previews, environment overrides, the cap on simultaneous previews, and how long a preview lives."
		>
			<div className="flex flex-col gap-4">
				{!gitBacked && (
					<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
						This compose service has no git provider, so no pull-request webhooks reach it. Point it
						at GitHub, GitLab, Bitbucket or Gitea under General to deploy previews automatically —
						you can still create one by hand below. <HelpLink slug="git" />
					</p>
				)}

				<div className="flex items-center justify-between rounded-md border p-3 sm:max-w-lg">
					<div className="flex flex-col gap-1">
						<Label htmlFor="compose-preview-deploys">Preview deployments</Label>
						<p className="text-xs text-muted-foreground">
							Create and tear down preview stacks from pull request webhooks.
						</p>
					</div>
					<Switch
						id="compose-preview-deploys"
						checked={enabled}
						disabled={!canWrite}
						onCheckedChange={(checked) => draft.patch({ enabled: checked })}
					/>
				</div>

				<div className="flex items-center justify-between rounded-md border p-3 sm:max-w-lg">
					<div className="flex flex-col gap-1">
						<Label htmlFor="compose-preview-fork-gate">Fork PRs require approval</Label>
						<p className="text-xs text-muted-foreground">
							Previews of fork pull requests wait for manual approval, unless the author is a repo
							collaborator. Recommended: fork code is untrusted.
						</p>
					</div>
					<Switch
						id="compose-preview-fork-gate"
						checked={forkGate}
						disabled={!canWrite}
						onCheckedChange={(checked) => draft.patch({ forkGate: checked })}
					/>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="compose-preview-env">Preview environment variables</Label>
					<Textarea
						id="compose-preview-env"
						className="min-h-24 font-mono text-xs sm:max-w-lg"
						placeholder={"DATABASE_URL=postgres://preview\nSTRIPE_KEY=sk_test_..."}
						value={previewEnv}
						disabled={!canWrite}
						onChange={(event) => draft.patch({ previewEnv: event.target.value })}
					/>
					<p className="text-xs text-muted-foreground">
						Merged over the inherited project, environment and service variables when a preview
						renders — point a preview stack at a scratch database instead of production.
					</p>
				</div>

				<div className="grid gap-4 sm:max-w-lg sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<Label htmlFor="compose-preview-limit">Maximum previews</Label>
						<Input
							id="compose-preview-limit"
							inputMode="numeric"
							value={limit}
							disabled={!canWrite}
							onChange={(event) => draft.patch({ limit: event.target.value })}
						/>
						<p className="text-xs text-muted-foreground">0 means no limit.</p>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="compose-preview-ttl">Expire after (hours)</Label>
						<Input
							id="compose-preview-ttl"
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
					target={{ composeId }}
					databaseTarget={databaseTarget}
					seedCommand={seedCommand}
					disabled={!canWrite}
					idPrefix="compose-preview"
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
