"use client";

import { useQuery } from "@tanstack/react-query";
import type { ComposeService } from "@/components/compose/compose-detail";
import {
	GIT_PROVIDER_LABELS,
	GitProviderRepoPicker,
	type GitProviderSourceType,
	splitRepoSelection,
} from "@/components/git-provider-repo-picker";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { capabilityHint } from "@/components/services/capability-hint";
import { useSaveBar } from "@/components/services/save-bar";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

type SourceType = ComposeService["sourceType"];

const GIT_PROVIDER_SOURCES = ["github", "gitlab", "bitbucket", "gitea"] as const;
type GitProviderSource = GitProviderSourceType;

function isGitProviderSource(sourceType: SourceType): sourceType is GitProviderSource {
	return (GIT_PROVIDER_SOURCES as readonly string[]).includes(sourceType);
}

function storedProviderId(compose: ComposeService): string {
	return compose.githubId ?? compose.gitlabId ?? compose.bitbucketId ?? compose.giteaId ?? "";
}

function storedRepoSelection(compose: ComposeService): string {
	return compose.owner && compose.repository ? `${compose.owner}/${compose.repository}` : "";
}

export function GeneralTab({
	compose,
	onOpenComposeFile,
}: {
	compose: ComposeService;
	/** Switch to the Compose file tab (raw sources are edited there). */
	onOpenComposeFile?: () => void;
}) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const canWrite = can("service.write");

	const serverProviderId = storedProviderId(compose);
	const serverRepoSelection = storedRepoSelection(compose);

	// The draft mirrors server values while the user is not editing — the
	// header's Deploy/Stop invalidate compose.one and a status flip must not
	// wipe the form (the whole `compose` object changes identity on every
	// refetch).
	const draft = useDraft({
		composeType: compose.composeType,
		isolatedDeployment: compose.isolatedDeployment,
		autoDeploy: compose.autoDeploy,
		buildEnabled: compose.buildEnabled,
		publishPorts: compose.publishPorts,
		buildArgs: compose.buildArgs ?? "",
		sourceType: compose.sourceType,
		gitUrl: compose.gitUrl ?? "",
		gitBranch: compose.gitBranch ?? "",
		repoSelection: serverRepoSelection,
		branch: compose.branch ?? "",
		composePath: compose.composePath,
		providerId: serverProviderId,
		preDeployCommand: compose.preDeployCommand ?? "",
		postDeployCommand: compose.postDeployCommand ?? "",
	});
	const {
		composeType,
		isolatedDeployment,
		autoDeploy,
		buildEnabled,
		buildArgs,
		publishPorts,
		sourceType,
		gitUrl,
		gitBranch,
		repoSelection,
		branch,
		composePath,
		providerId,
		preDeployCommand,
		postDeployCommand,
	} = draft.value;

	/**
	 * Switching the source type must not carry the previous provider's id /
	 * owner / repository along; re-seed from the stored service only when
	 * switching back to its persisted source type.
	 */
	const changeSourceType = (next: SourceType) => {
		const restore = next === compose.sourceType;
		draft.patch({
			sourceType: next,
			providerId: restore ? serverProviderId : "",
			repoSelection: restore ? serverRepoSelection : "",
			branch: restore ? (compose.branch ?? "") : "",
			gitUrl: restore ? (compose.gitUrl ?? "") : "",
			gitBranch: restore ? (compose.gitBranch ?? "") : "",
		});
	};

	const githubQuery = useQuery({
		...trpc.github.all.queryOptions(),
		enabled: sourceType === "github",
	});
	const gitlabQuery = useQuery({
		...trpc.gitlab.all.queryOptions(),
		enabled: sourceType === "gitlab",
	});
	const bitbucketQuery = useQuery({
		...trpc.bitbucket.all.queryOptions(),
		enabled: sourceType === "bitbucket",
	});
	const giteaQuery = useQuery({
		...trpc.gitea.all.queryOptions(),
		enabled: sourceType === "gitea",
	});

	// Each provider router returns rows joined with the shared gitProvider
	// record; normalize to { id, name } for the select.
	const providers: { id: string; name: string }[] =
		sourceType === "github"
			? (githubQuery.data ?? []).map((row) => ({
					id: row.github.githubId,
					name: row.gitProvider.name,
				}))
			: sourceType === "gitlab"
				? (gitlabQuery.data ?? []).map((row) => ({
						id: row.gitlab.gitlabId,
						name: row.gitProvider.name,
					}))
				: sourceType === "bitbucket"
					? (bitbucketQuery.data ?? []).map((row) => ({
							id: row.bitbucket.bitbucketId,
							name: row.gitProvider.name,
						}))
					: sourceType === "gitea"
						? (giteaQuery.data ?? []).map((row) => ({
								id: row.gitea.giteaId,
								name: row.gitProvider.name,
							}))
						: [];
	const providersLoading =
		githubQuery.isLoading ||
		gitlabQuery.isLoading ||
		bitbucketQuery.isLoading ||
		giteaQuery.isLoading;

	const updateMutation = useSaveMutation(trpc.compose.update.mutationOptions(), {
		successMessage: "Compose service updated",
		invalidate: [trpc.compose.one.queryKey({ composeId: compose.composeId })],
		// Refetch is done: the server now holds what was typed.
		onSuccess: draft.markSaved,
	});

	const onSave = () => {
		const providerIds: Record<GitProviderSource, string | null> = {
			github: null,
			gitlab: null,
			bitbucket: null,
			gitea: null,
		};
		if (isGitProviderSource(sourceType)) {
			providerIds[sourceType] = providerId || null;
		}

		const { owner, repository } = splitRepoSelection(repoSelection);

		updateMutation.mutate({
			composeId: compose.composeId,
			composeType,
			isolatedDeployment,
			autoDeploy,
			buildEnabled,
			buildArgs: buildArgs.trim() || null,
			publishPorts,
			sourceType,
			gitUrl: sourceType === "git" ? gitUrl || null : null,
			gitBranch: sourceType === "git" ? gitBranch || null : null,
			owner: isGitProviderSource(sourceType) ? owner || null : null,
			repository: isGitProviderSource(sourceType) ? repository || null : null,
			branch: isGitProviderSource(sourceType) ? branch || null : null,
			composePath: composePath || "./docker-compose.yml",
			githubId: providerIds.github,
			gitlabId: providerIds.gitlab,
			bitbucketId: providerIds.bitbucket,
			giteaId: providerIds.gitea,
			preDeployCommand: preDeployCommand.trim() || null,
			postDeployCommand: postDeployCommand.trim() || null,
		});
	};

	useSaveBar(draft, { onSave, pending: updateMutation.isPending, disabled: !canWrite });

	return (
		<SettingsStack>
			<SettingsSection title="General" description="How this compose file is deployed.">
				<div className="flex flex-col gap-6">
					<div className="flex flex-col gap-2">
						<Label htmlFor="compose-type">Compose type</Label>
						<Select
							value={composeType}
							onValueChange={(value) =>
								draft.patch({ composeType: value as ComposeService["composeType"] })
							}
						>
							<SelectTrigger id="compose-type" className="max-w-sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="docker-compose">Docker Compose</SelectItem>
								<SelectItem value="stack">Swarm Stack</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-sm text-muted-foreground">
							Stack mode deploys with <code>docker stack deploy</code> instead of{" "}
							<code>docker compose up</code>. <HelpLink slug="deploy" />
						</p>
					</div>
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div>
							<Label htmlFor="isolated-deployment">Isolated deployment</Label>
							<p className="text-sm text-muted-foreground">
								Randomize service and container names to avoid collisions between copies of this
								compose file. <HelpLink slug="deploy" />
							</p>
						</div>
						<Switch
							id="isolated-deployment"
							checked={isolatedDeployment}
							onCheckedChange={(checked) => draft.patch({ isolatedDeployment: checked })}
						/>
					</div>
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div>
							<Label htmlFor="auto-deploy">Auto deploy</Label>
							<p className="text-sm text-muted-foreground">
								Deploy automatically when the source repository changes.
							</p>
						</div>
						<Switch
							id="auto-deploy"
							checked={autoDeploy}
							onCheckedChange={(checked) => draft.patch({ autoDeploy: checked })}
						/>
					</div>
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div>
							<Label htmlFor="build-enabled">Build services from source</Label>
							<p className="text-sm text-muted-foreground">
								Let services in this stack use <code>build:</code>. Nixploy builds each one from the
								repository and deploys the resulting image — compose never reads a path on the host.
							</p>
						</div>
						<Switch
							id="build-enabled"
							checked={buildEnabled}
							disabled={!canWrite}
							onCheckedChange={(checked) => draft.patch({ buildEnabled: checked })}
						/>
					</div>
					{buildEnabled && (
						<div className="flex flex-col gap-2">
							<Label htmlFor="compose-build-args">Build args</Label>
							<Textarea
								id="compose-build-args"
								className="min-h-16 font-mono text-xs sm:max-w-lg"
								placeholder="NODE_ENV=production"
								value={buildArgs}
								disabled={!canWrite}
								onChange={(event) => draft.patch({ buildArgs: event.target.value })}
							/>
							<p className="text-sm text-muted-foreground">
								One <code>KEY=VALUE</code> per line, shared by every build service of the stack.
								Credential-shaped keys are passed as BuildKit secrets instead of build args, so they
								stay out of the image history.
							</p>
						</div>
					)}
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div>
							<Label htmlFor="publish-ports">Publish host ports</Label>
							<p className="text-sm text-muted-foreground">
								Let services in this stack bind host ports with <code>ports:</code>. A published
								port bypasses Traefik, so domains, TLS and middlewares do not apply to it.
								Privileged, database and platform ports stay blocked.
							</p>
						</div>
						<Switch
							id="publish-ports"
							checked={publishPorts}
							disabled={!canWrite}
							onCheckedChange={(checked) => draft.patch({ publishPorts: checked })}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="compose-pre-deploy">Pre-deploy command</Label>
						<Textarea
							id="compose-pre-deploy"
							className="min-h-16 font-mono text-xs sm:max-w-lg"
							placeholder="php artisan down"
							value={preDeployCommand}
							disabled={!canWrite}
							onChange={(event) => draft.patch({ preDeployCommand: event.target.value })}
						/>
						<p className="text-sm text-muted-foreground">
							Runs in a container of the project that is currently running, before it is replaced
							(skipped on the first deploy). A non-zero exit aborts the deployment and leaves the
							running project untouched.
						</p>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="compose-post-deploy">Post-deploy command</Label>
						<Textarea
							id="compose-post-deploy"
							className="min-h-16 font-mono text-xs sm:max-w-lg"
							placeholder="php artisan migrate --force"
							value={postDeployCommand}
							disabled={!canWrite}
							onChange={(event) => draft.patch({ postDeployCommand: event.target.value })}
						/>
						<p className="text-sm text-muted-foreground">
							Runs in a container of the project that was just brought up. A non-zero exit marks the
							deployment failed. Save from the button at the bottom of this page.
						</p>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection title="Source" description="Where the compose file comes from.">
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="source-type">Source type</Label>
						<Select
							value={sourceType}
							onValueChange={(value) => changeSourceType(value as SourceType)}
						>
							<SelectTrigger id="source-type" className="max-w-sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="raw">Raw (paste)</SelectItem>
								<SelectItem value="git">Git</SelectItem>
								<SelectItem value="github">GitHub</SelectItem>
								<SelectItem value="gitlab">GitLab</SelectItem>
								<SelectItem value="bitbucket">Bitbucket</SelectItem>
								<SelectItem value="gitea">Gitea</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{sourceType === "raw" && (
						<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
							The compose file is stored directly on this service.{" "}
							{onOpenComposeFile ? (
								<button
									type="button"
									onClick={onOpenComposeFile}
									className="font-medium text-foreground underline-offset-4 hover:underline"
								>
									Edit it in the Compose file tab →
								</button>
							) : (
								<>
									Edit it in the <span className="font-medium">Compose file</span> tab.
								</>
							)}
						</p>
					)}

					{sourceType === "git" && (
						<>
							<div className="flex flex-col gap-2">
								<Label htmlFor="git-url">Repository URL</Label>
								<Input
									id="git-url"
									placeholder="https://github.com/org/repo.git"
									value={gitUrl}
									onChange={(e) => draft.patch({ gitUrl: e.target.value })}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="git-branch">Branch</Label>
								<Input
									id="git-branch"
									placeholder="main"
									value={gitBranch}
									onChange={(e) => draft.patch({ gitBranch: e.target.value })}
								/>
							</div>
						</>
					)}

					{isGitProviderSource(sourceType) && (
						<>
							<div className="flex flex-col gap-2">
								<Label htmlFor="provider">Provider</Label>
								<Select
									value={providerId}
									onValueChange={(value) => draft.patch({ providerId: value })}
								>
									<SelectTrigger id="provider" className="max-w-sm">
										<SelectValue
											placeholder={providersLoading ? "Loading providers…" : "Select a provider"}
										/>
									</SelectTrigger>
									<SelectContent>
										{providers.map((provider) => (
											<SelectItem key={provider.id} value={provider.id}>
												{provider.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{!providersLoading && providers.length === 0 && (
									<p className="text-sm text-muted-foreground">
										No {GIT_PROVIDER_LABELS[sourceType]} provider configured yet — add one under
										Settings → Git providers.
									</p>
								)}
							</div>
							<GitProviderRepoPicker
								sourceType={sourceType}
								providerId={providerId}
								repoSelection={repoSelection}
								onRepoSelectionChange={(value) => draft.patch({ repoSelection: value })}
								branch={branch}
								onBranchChange={(value) => draft.patch({ branch: value })}
							/>
						</>
					)}

					{sourceType !== "raw" && (
						<div className="flex flex-col gap-2">
							<Label htmlFor="compose-path">Compose path</Label>
							<Input
								id="compose-path"
								placeholder="./docker-compose.yml"
								value={composePath}
								onChange={(e) => draft.patch({ composePath: e.target.value })}
							/>
						</div>
					)}

					<div className="flex items-center justify-end gap-3">
						<UnsavedChangesPill dirty={draft.dirty} />
						<DisabledHint hint={canWrite ? undefined : capabilityHint("service.write")}>
							<Button onClick={onSave} disabled={updateMutation.isPending || !canWrite}>
								{updateMutation.isPending ? "Saving…" : "Save"}
							</Button>
						</DisabledHint>
					</div>
				</div>
			</SettingsSection>
		</SettingsStack>
	);
}
