"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DropUpload } from "@/components/application/drop-upload";
import {
	GIT_PROVIDER_LABELS,
	GitProviderRepoPicker,
	type GitProviderSourceType,
	splitRepoSelection,
} from "@/components/git-provider-repo-picker";
import { SettingsSection } from "@/components/layout/settings-section";
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

import type { Application } from "./types";

type SourceType = Application["sourceType"];

const SOURCE_TYPES: { value: SourceType; label: string }[] = [
	{ value: "github", label: "GitHub" },
	{ value: "git", label: "Git (generic)" },
	{ value: "gitlab", label: "GitLab" },
	{ value: "bitbucket", label: "Bitbucket" },
	{ value: "gitea", label: "Gitea" },
	{ value: "docker", label: "Docker image" },
	{ value: "drop", label: "Drop (zip upload)" },
];

const NONE = "__none__";

// Server caps for watch paths (`packages/server/src/utils/input-limits.ts`).
const MAX_WATCH_PATHS = 50;
const MAX_WATCH_PATH_LENGTH = 256;
const MAX_WATCH_PATH_GLOBSTARS = 3;
const MAX_WATCH_PATH_STARS = 8;

/** One glob per line → array; blank lines dropped; `null` when empty (matches every push). */
function parseWatchPaths(text: string): string[] | null {
	const patterns = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return patterns.length > 0 ? patterns : null;
}

/** Client-side mirror of the server validation so the error names the line. */
function watchPathsError(patterns: string[] | null): string | null {
	if (!patterns) return null;
	if (patterns.length > MAX_WATCH_PATHS) return `At most ${MAX_WATCH_PATHS} watch paths`;
	for (const pattern of patterns) {
		if (pattern.length > MAX_WATCH_PATH_LENGTH) {
			return `"${pattern.slice(0, 24)}…" is longer than ${MAX_WATCH_PATH_LENGTH} characters`;
		}
		if ((pattern.match(/\*\*/g)?.length ?? 0) > MAX_WATCH_PATH_GLOBSTARS) {
			return `"${pattern}" has more than ${MAX_WATCH_PATH_GLOBSTARS} "**" wildcards`;
		}
		if ((pattern.match(/\*/g)?.length ?? 0) > MAX_WATCH_PATH_STARS) {
			return `"${pattern}" has more than ${MAX_WATCH_PATH_STARS} "*" wildcards`;
		}
	}
	return null;
}

function isGitLikeSource(sourceType: SourceType): boolean {
	return sourceType === "git" || isGitProviderSource(sourceType);
}

function isGitProviderSource(sourceType: SourceType): sourceType is GitProviderSourceType {
	return (
		sourceType === "github" ||
		sourceType === "gitlab" ||
		sourceType === "bitbucket" ||
		sourceType === "gitea"
	);
}

/** Provider id stored for the application's current provider-backed source. */
function storedProviderId(application: Application): string {
	return (
		application.githubId ??
		application.gitlabId ??
		application.bitbucketId ??
		application.giteaId ??
		""
	);
}

function storedRepoSelection(application: Application): string {
	return application.owner && application.repository
		? `${application.owner}/${application.repository}`
		: "";
}

export function SourceConfig({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	const serverProviderId = storedProviderId(application);
	const serverRepoSelection = storedRepoSelection(application);
	const serverWatchPaths = (application.watchPaths ?? []).join("\n");

	// The draft mirrors server values while the user is not editing —
	// background refetches (deploy status flips, window focus) must not wipe
	// typed text.
	const draft = useDraft({
		sourceType: application.sourceType,
		// generic git
		gitUrl: application.gitUrl ?? "",
		gitBranch: application.gitBranch ?? "",
		sshKeyId: application.customGitSSHKeyId ?? NONE,
		// provider-backed git
		providerId: serverProviderId,
		repoSelection: serverRepoSelection,
		branch: application.branch ?? "",
		buildPath: application.buildPath ?? "/",
		autoDeploy: application.autoDeploy,
		isPreviewDeploymentsActive: application.isPreviewDeploymentsActive,
		previewForksRequireApproval: application.previewForksRequireApproval,
		watchPathsText: serverWatchPaths,
		// docker
		dockerImage: application.dockerImage ?? "",
		dockerUsername: application.username ?? "",
		dockerPassword: "",
		registryId: application.registryId ?? NONE,
		autoUpdateImage: application.autoUpdateImage,
	});
	const {
		sourceType,
		gitUrl,
		gitBranch,
		sshKeyId,
		providerId,
		repoSelection,
		branch,
		buildPath,
		autoDeploy,
		isPreviewDeploymentsActive,
		previewForksRequireApproval,
		watchPathsText,
		dockerImage,
		dockerUsername,
		dockerPassword,
		registryId,
		autoUpdateImage,
	} = draft.value;

	/**
	 * Switching the source type must not carry the previous provider's id /
	 * owner / repository along — the Select would render blank (the id is not
	 * in the new provider list) while Save silently sent the stale values.
	 * Fields are re-seeded from the stored application only when switching
	 * back to its persisted source type.
	 */
	const changeSourceType = (next: SourceType) => {
		const restore = next === application.sourceType;
		draft.patch({
			sourceType: next,
			providerId: restore ? serverProviderId : "",
			repoSelection: restore ? serverRepoSelection : "",
			branch: restore ? (application.branch ?? "") : "",
			gitUrl: restore ? (application.gitUrl ?? "") : "",
			gitBranch: restore ? (application.gitBranch ?? "") : "",
			sshKeyId: restore ? (application.customGitSSHKeyId ?? NONE) : NONE,
			dockerImage: restore ? (application.dockerImage ?? "") : "",
			dockerUsername: restore ? (application.username ?? "") : "",
			dockerPassword: "",
			registryId: restore ? (application.registryId ?? NONE) : NONE,
		});
	};

	// ── pickers ─────────────────────────────────────────────────────────────
	const sshKeys = useQuery(trpc.sshKey.all.queryOptions());
	const registries = useQuery(trpc.registry.all.queryOptions());
	const githubProviders = useQuery(trpc.github.all.queryOptions());
	const gitlabProviders = useQuery(trpc.gitlab.all.queryOptions());
	const bitbucketProviders = useQuery(trpc.bitbucket.all.queryOptions());
	const giteaProviders = useQuery(trpc.gitea.all.queryOptions());

	// Each provider router returns rows joined with the shared gitProvider
	// record; normalize to { id, name } for the select.
	const providerOptions: { id: string; name: string }[] =
		sourceType === "github"
			? (githubProviders.data ?? []).map((row) => ({
					id: row.github.githubId,
					name: row.gitProvider.name,
				}))
			: sourceType === "gitlab"
				? (gitlabProviders.data ?? []).map((row) => ({
						id: row.gitlab.gitlabId,
						name: row.gitProvider.name,
					}))
				: sourceType === "bitbucket"
					? (bitbucketProviders.data ?? []).map((row) => ({
							id: row.bitbucket.bitbucketId,
							name: row.gitProvider.name,
						}))
					: sourceType === "gitea"
						? (giteaProviders.data ?? []).map((row) => ({
								id: row.gitea.giteaId,
								name: row.gitProvider.name,
							}))
						: [];

	// ── save ────────────────────────────────────────────────────────────────
	const saveSource = useSaveMutation(trpc.application.saveSource.mutationOptions(), {
		successMessage: "Source configuration saved",
		invalidate: [trpc.application.one.queryKey({ applicationId })],
		// Refetch is done: the server now holds what was typed.
		onSuccess: draft.markSaved,
	});

	const canWrite = can("service.write");
	const canWriteSecrets = can("secrets.write");
	// A docker password is a secret; the server additionally requires secrets.write for it.
	const needsSecrets = sourceType === "docker" && dockerPassword !== "";
	const saveBlocked = !canWrite || (needsSecrets && !canWriteSecrets);
	const saveHint = !canWrite
		? capabilityHint("service.write")
		: needsSecrets && !canWriteSecrets
			? capabilityHint("secrets.write")
			: undefined;

	const watchPaths = parseWatchPaths(watchPathsText);
	const watchPathsProblem = isGitLikeSource(sourceType) ? watchPathsError(watchPaths) : null;

	const onSave = () => {
		if (watchPathsProblem) {
			toast.error(watchPathsProblem);
			return;
		}
		const base = {
			applicationId,
			buildPath,
			autoDeploy,
			isPreviewDeploymentsActive,
			previewForksRequireApproval,
			// Docker/drop sources have no push webhook; clear stale patterns.
			watchPaths: isGitLikeSource(sourceType) ? watchPaths : null,
		};
		switch (sourceType) {
			case "git":
				saveSource.mutate({
					...base,
					sourceType,
					gitUrl,
					gitBranch,
					customGitSSHKeyId: sshKeyId === NONE ? null : sshKeyId,
				});
				break;
			case "github":
			case "gitlab":
			case "bitbucket":
			case "gitea": {
				const { owner, repository } = splitRepoSelection(repoSelection);
				saveSource.mutate({
					...base,
					sourceType,
					[`${sourceType}Id`]: providerId || null,
					owner: owner || null,
					repository: repository || null,
					branch: branch || null,
				} as Parameters<typeof saveSource.mutate>[0]);
				break;
			}
			case "docker":
				saveSource.mutate({
					...base,
					sourceType,
					dockerImage,
					username: dockerUsername || null,
					password: dockerPassword || null,
					registryId: registryId === NONE ? null : registryId,
					autoUpdateImage,
				});
				break;
			case "drop":
				saveSource.mutate({ ...base, sourceType });
				break;
		}
	};

	const isGitLike = isGitLikeSource(sourceType);

	useSaveBar(draft, { onSave, pending: saveSource.isPending, disabled: saveBlocked });

	return (
		<SettingsSection
			title="Source"
			description="Where the code or image for this application comes from."
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label>Source type</Label>
					<Select value={sourceType} onValueChange={(v) => changeSourceType(v as SourceType)}>
						<SelectTrigger className="w-full sm:max-w-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SOURCE_TYPES.map((s) => (
								<SelectItem key={s.value} value={s.value}>
									{s.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{sourceType === "git" && (
					<>
						<div className="flex flex-col gap-2">
							<Label htmlFor="git-url">Repository URL</Label>
							<Input
								id="git-url"
								placeholder="https://github.com/user/repo.git"
								value={gitUrl}
								onChange={(e) => draft.patch({ gitUrl: e.target.value })}
							/>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-2">
								<Label htmlFor="git-branch">Branch</Label>
								<Input
									id="git-branch"
									placeholder="main"
									value={gitBranch}
									onChange={(e) => draft.patch({ gitBranch: e.target.value })}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label>SSH key (optional)</Label>
								<Select
									value={sshKeyId}
									onValueChange={(value) => draft.patch({ sshKeyId: value })}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="None" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NONE}>None</SelectItem>
										{sshKeys.data?.map((key) => (
											<SelectItem key={key.sshKeyId} value={key.sshKeyId}>
												{key.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					</>
				)}

				{isGitProviderSource(sourceType) && (
					<>
						<div className="flex flex-col gap-2">
							<Label>{GIT_PROVIDER_LABELS[sourceType]} Provider</Label>
							<Select
								value={providerId}
								onValueChange={(value) => draft.patch({ providerId: value })}
							>
								<SelectTrigger className="w-full sm:max-w-xs">
									<SelectValue placeholder="Select a provider" />
								</SelectTrigger>
								<SelectContent>
									{providerOptions.map((provider) => (
										<SelectItem key={provider.id} value={provider.id}>
											{provider.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{providerOptions.length === 0 && (
								<p className="text-xs text-muted-foreground">
									No {GIT_PROVIDER_LABELS[sourceType]} providers configured. Add one under Settings
									→ Git providers.
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

				{sourceType === "docker" && (
					<>
						<div className="flex flex-col gap-2">
							<Label htmlFor="docker-image">Docker image</Label>
							<Input
								id="docker-image"
								placeholder="nginx:latest"
								value={dockerImage}
								onChange={(e) => draft.patch({ dockerImage: e.target.value })}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Registry (optional)</Label>
							<Select
								value={registryId}
								onValueChange={(value) => draft.patch({ registryId: value })}
							>
								<SelectTrigger className="w-full sm:max-w-xs">
									<SelectValue placeholder="None" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NONE}>None</SelectItem>
									{registries.data?.map((reg) => (
										<SelectItem key={reg.registryId} value={reg.registryId}>
											{reg.registryName}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center justify-between rounded-md border p-3">
							<div className="flex flex-col gap-1">
								<Label htmlFor="auto-update-image">Auto-update image</Label>
								<p className="text-xs text-muted-foreground">
									Check this tag&apos;s digest hourly and redeploy when it moves. Public registries
									only — a private image needs credentials the check cannot use.
								</p>
							</div>
							<Switch
								id="auto-update-image"
								checked={autoUpdateImage}
								onCheckedChange={(checked) => draft.patch({ autoUpdateImage: checked })}
							/>
						</div>
						{registryId === NONE && (
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="flex flex-col gap-2">
									<Label htmlFor="docker-username">Username (optional)</Label>
									<Input
										id="docker-username"
										value={dockerUsername}
										onChange={(e) => draft.patch({ dockerUsername: e.target.value })}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="docker-password">Password (optional)</Label>
									<Input
										id="docker-password"
										type="password"
										placeholder={application.password ? "••••••••" : ""}
										value={dockerPassword}
										onChange={(e) => draft.patch({ dockerPassword: e.target.value })}
									/>
								</div>
							</div>
						)}
					</>
				)}

				{sourceType === "drop" && <DropUpload applicationId={application.applicationId} />}

				{isGitLike && (
					<>
						<div className="flex flex-col gap-2">
							<Label htmlFor="build-path">Build path</Label>
							<Input
								id="build-path"
								placeholder="/"
								className="sm:max-w-xs"
								value={buildPath}
								onChange={(e) => draft.patch({ buildPath: e.target.value })}
							/>
						</div>
						<div className="flex items-center justify-between rounded-md border p-3">
							<div className="flex flex-col gap-1">
								<Label htmlFor="auto-deploy">Auto deploy</Label>
								<p className="text-xs text-muted-foreground">
									Deploy automatically when new commits are pushed.
								</p>
							</div>
							<Switch
								id="auto-deploy"
								checked={autoDeploy}
								onCheckedChange={(checked) => draft.patch({ autoDeploy: checked })}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="watch-paths">Watch paths (optional)</Label>
							<Textarea
								id="watch-paths"
								className="min-h-24 font-mono text-xs sm:max-w-lg"
								placeholder={"apps/web/**\npackages/shared/**\n!**/*.md"}
								value={watchPathsText}
								onChange={(e) => draft.patch({ watchPathsText: e.target.value })}
								aria-invalid={watchPathsProblem ? true : undefined}
							/>
							<p className="text-xs text-muted-foreground">
								One glob per line. A push webhook only deploys when a changed file matches; empty
								means every push. At most {MAX_WATCH_PATHS} patterns of {MAX_WATCH_PATH_LENGTH}{" "}
								characters, {MAX_WATCH_PATH_GLOBSTARS} <code className="font-mono">**</code> and{" "}
								{MAX_WATCH_PATH_STARS} <code className="font-mono">*</code> per pattern.{" "}
								<HelpLink slug="git" />
							</p>
							{watchPathsProblem && <p className="text-xs text-destructive">{watchPathsProblem}</p>}
						</div>
						{isGitProviderSource(sourceType) && (
							<>
								<div className="flex items-center justify-between rounded-md border p-3">
									<div className="flex flex-col gap-1">
										<Label htmlFor="preview-deploys">Preview deployments</Label>
										<p className="text-xs text-muted-foreground">
											Create and tear down preview environments from pull request webhooks.
										</p>
									</div>
									<Switch
										id="preview-deploys"
										checked={isPreviewDeploymentsActive}
										onCheckedChange={(checked) =>
											draft.patch({ isPreviewDeploymentsActive: checked })
										}
									/>
								</div>
								<div className="flex items-center justify-between rounded-md border p-3">
									<div className="flex flex-col gap-1">
										<Label htmlFor="preview-fork-gate">Fork PRs require approval</Label>
										<p className="text-xs text-muted-foreground">
											Preview builds from fork pull requests wait for manual approval, unless the
											author is a repo collaborator. Recommended: fork code is untrusted.
										</p>
									</div>
									<Switch
										id="preview-fork-gate"
										checked={previewForksRequireApproval}
										onCheckedChange={(checked) =>
											draft.patch({ previewForksRequireApproval: checked })
										}
									/>
								</div>
							</>
						)}
					</>
				)}

				<div className="flex items-center justify-end gap-3">
					<UnsavedChangesPill dirty={draft.dirty} />
					<DisabledHint hint={saveHint}>
						<Button onClick={onSave} disabled={saveSource.isPending || saveBlocked}>
							{saveSource.isPending && <Loader2 className="size-4 animate-spin" />}
							Save source
						</Button>
					</DisabledHint>
				</div>
			</div>
		</SettingsSection>
	);
}
