"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	GIT_PROVIDER_LABELS,
	GitProviderRepoPicker,
	type GitProviderSourceType,
	splitRepoSelection,
} from "@/components/git-provider-repo-picker";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
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
import { useTRPC } from "@/lib/trpc";

import type { Application } from "./types";

type SourceType = Application["sourceType"];

const SOURCE_TYPES: { value: SourceType; label: string }[] = [
	{ value: "github", label: "GitHub" },
	{ value: "git", label: "Git (generic)" },
	{ value: "gitlab", label: "GitLab" },
	{ value: "bitbucket", label: "Bitbucket" },
	{ value: "gitea", label: "Gitea" },
	{ value: "docker", label: "Docker Image" },
	{ value: "drop", label: "Drop (zip upload)" },
];

const NONE = "__none__";

function isGitProviderSource(sourceType: SourceType): sourceType is GitProviderSourceType {
	return (
		sourceType === "github" ||
		sourceType === "gitlab" ||
		sourceType === "bitbucket" ||
		sourceType === "gitea"
	);
}

export function SourceConfig({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const applicationId = application.applicationId;

	const [sourceType, setSourceType] = useState<SourceType>(application.sourceType);
	// generic git
	const [gitUrl, setGitUrl] = useState(application.gitUrl ?? "");
	const [gitBranch, setGitBranch] = useState(application.gitBranch ?? "");
	const [sshKeyId, setSshKeyId] = useState(application.customGitSSHKeyId ?? NONE);
	// provider-backed git
	const [providerId, setProviderId] = useState(
		application.githubId ??
			application.gitlabId ??
			application.bitbucketId ??
			application.giteaId ??
			"",
	);
	const [repoSelection, setRepoSelection] = useState(
		application.owner && application.repository
			? `${application.owner}/${application.repository}`
			: "",
	);
	const [branch, setBranch] = useState(application.branch ?? "");
	const [buildPath, setBuildPath] = useState(application.buildPath ?? "/");
	const [autoDeploy, setAutoDeploy] = useState(application.autoDeploy);
	const [isPreviewDeploymentsActive, setIsPreviewDeploymentsActive] = useState(
		application.isPreviewDeploymentsActive,
	);
	const [previewForksRequireApproval, setPreviewForksRequireApproval] = useState(
		application.previewForksRequireApproval,
	);
	// docker
	const [dockerImage, setDockerImage] = useState(application.dockerImage ?? "");
	const [dockerUsername, setDockerUsername] = useState(application.username ?? "");
	const [dockerPassword, setDockerPassword] = useState("");
	const [registryId, setRegistryId] = useState(application.registryId ?? NONE);

	useEffect(() => {
		setSourceType(application.sourceType);
		setGitUrl(application.gitUrl ?? "");
		setGitBranch(application.gitBranch ?? "");
		setSshKeyId(application.customGitSSHKeyId ?? NONE);
		setProviderId(
			application.githubId ??
				application.gitlabId ??
				application.bitbucketId ??
				application.giteaId ??
				"",
		);
		setRepoSelection(
			application.owner && application.repository
				? `${application.owner}/${application.repository}`
				: "",
		);
		setBranch(application.branch ?? "");
		setBuildPath(application.buildPath ?? "/");
		setAutoDeploy(application.autoDeploy);
		setIsPreviewDeploymentsActive(application.isPreviewDeploymentsActive);
		setPreviewForksRequireApproval(application.previewForksRequireApproval);
		setDockerImage(application.dockerImage ?? "");
		setDockerUsername(application.username ?? "");
		setDockerPassword("");
		setRegistryId(application.registryId ?? NONE);
	}, [application]);

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
	const saveSource = useMutation(
		trpc.application.saveSource.mutationOptions({
			onSuccess: () => {
				toast.success("Source configuration saved");
				queryClient.invalidateQueries({
					queryKey: trpc.application.one.queryKey({ applicationId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const onSave = () => {
		const base = {
			applicationId,
			buildPath,
			autoDeploy,
			isPreviewDeploymentsActive,
			previewForksRequireApproval,
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
				});
				break;
			case "drop":
				saveSource.mutate({ ...base, sourceType });
				break;
		}
	};

	const isGitLike =
		sourceType === "git" ||
		sourceType === "github" ||
		sourceType === "gitlab" ||
		sourceType === "bitbucket" ||
		sourceType === "gitea";

	return (
		<SettingsSection
			title="Source"
			description="Where the code or image for this application comes from."
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label>Source Type</Label>
					<Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
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
								onChange={(e) => setGitUrl(e.target.value)}
							/>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="flex flex-col gap-2">
								<Label htmlFor="git-branch">Branch</Label>
								<Input
									id="git-branch"
									placeholder="main"
									value={gitBranch}
									onChange={(e) => setGitBranch(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label>SSH Key (optional)</Label>
								<Select value={sshKeyId} onValueChange={setSshKeyId}>
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
							<Select value={providerId} onValueChange={setProviderId}>
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
									→ Git Providers.
								</p>
							)}
						</div>
						<GitProviderRepoPicker
							sourceType={sourceType}
							providerId={providerId}
							repoSelection={repoSelection}
							onRepoSelectionChange={setRepoSelection}
							branch={branch}
							onBranchChange={setBranch}
						/>
					</>
				)}

				{sourceType === "docker" && (
					<>
						<div className="flex flex-col gap-2">
							<Label htmlFor="docker-image">Docker Image</Label>
							<Input
								id="docker-image"
								placeholder="nginx:latest"
								value={dockerImage}
								onChange={(e) => setDockerImage(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>Registry (optional)</Label>
							<Select value={registryId} onValueChange={setRegistryId}>
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
						{registryId === NONE && (
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="flex flex-col gap-2">
									<Label htmlFor="docker-username">Username (optional)</Label>
									<Input
										id="docker-username"
										value={dockerUsername}
										onChange={(e) => setDockerUsername(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="docker-password">Password (optional)</Label>
									<Input
										id="docker-password"
										type="password"
										placeholder={application.password ? "••••••••" : ""}
										value={dockerPassword}
										onChange={(e) => setDockerPassword(e.target.value)}
									/>
								</div>
							</div>
						)}
					</>
				)}

				{sourceType === "drop" && (
					<div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
						Upload a <span className="font-medium text-foreground">.zip</span> of your project to
						deploy it. Trigger a deployment with the{" "}
						<span className="font-medium text-foreground">Deploy</span> button and upload the
						archive through the Nixploy API or CLI (
						<code className="rounded bg-muted px-1">nixploy deploy --drop ./app.zip</code>
						). The zip is extracted into the application&apos;s code directory and built with the
						selected build type.
					</div>
				)}

				{isGitLike && (
					<>
						<div className="flex flex-col gap-2">
							<Label htmlFor="build-path">Build Path</Label>
							<Input
								id="build-path"
								placeholder="/"
								className="sm:max-w-xs"
								value={buildPath}
								onChange={(e) => setBuildPath(e.target.value)}
							/>
						</div>
						<div className="flex items-center justify-between rounded-md border p-3">
							<div className="flex flex-col gap-1">
								<Label htmlFor="auto-deploy">Auto Deploy</Label>
								<p className="text-xs text-muted-foreground">
									Deploy automatically when new commits are pushed.
								</p>
							</div>
							<Switch id="auto-deploy" checked={autoDeploy} onCheckedChange={setAutoDeploy} />
						</div>
						{isGitProviderSource(sourceType) && (
							<>
								<div className="flex items-center justify-between rounded-md border p-3">
									<div className="flex flex-col gap-1">
										<Label htmlFor="preview-deploys">Preview Deployments</Label>
										<p className="text-xs text-muted-foreground">
											Create and tear down preview environments from pull request webhooks.
										</p>
									</div>
									<Switch
										id="preview-deploys"
										checked={isPreviewDeploymentsActive}
										onCheckedChange={setIsPreviewDeploymentsActive}
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
										onCheckedChange={setPreviewForksRequireApproval}
									/>
								</div>
							</>
						)}
					</>
				)}

				<div className="flex justify-end">
					<Button onClick={onSave} disabled={saveSource.isPending}>
						{saveSource.isPending && <Loader2 className="size-4 animate-spin" />}
						Save Source
					</Button>
				</div>
			</div>
		</SettingsSection>
	);
}
