"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import {
	GIT_PROVIDER_LABELS,
	GitProviderRepoPicker,
	type GitProviderSourceType,
	splitRepoSelection,
} from "@/components/git-provider-repo-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type SourceType = ComposeService["sourceType"];

const GIT_PROVIDER_SOURCES = ["github", "gitlab", "bitbucket", "gitea"] as const;
type GitProviderSource = GitProviderSourceType;

function isGitProviderSource(sourceType: SourceType): sourceType is GitProviderSource {
	return (GIT_PROVIDER_SOURCES as readonly string[]).includes(sourceType);
}

export function GeneralTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [composeType, setComposeType] = useState(compose.composeType);
	const [isolatedDeployment, setIsolatedDeployment] = useState(compose.isolatedDeployment);
	const [autoDeploy, setAutoDeploy] = useState(compose.autoDeploy);
	const [sourceType, setSourceType] = useState<SourceType>(compose.sourceType);
	const [gitUrl, setGitUrl] = useState(compose.gitUrl ?? "");
	const [gitBranch, setGitBranch] = useState(compose.gitBranch ?? "");
	const [repoSelection, setRepoSelection] = useState(
		compose.owner && compose.repository ? `${compose.owner}/${compose.repository}` : "",
	);
	const [branch, setBranch] = useState(compose.branch ?? "");
	const [composePath, setComposePath] = useState(compose.composePath);
	const [providerId, setProviderId] = useState(
		compose.githubId ?? compose.gitlabId ?? compose.bitbucketId ?? compose.giteaId ?? "",
	);

	// Reset the form when the service data changes (e.g. after a save).
	useEffect(() => {
		setComposeType(compose.composeType);
		setIsolatedDeployment(compose.isolatedDeployment);
		setAutoDeploy(compose.autoDeploy);
		setSourceType(compose.sourceType);
		setGitUrl(compose.gitUrl ?? "");
		setGitBranch(compose.gitBranch ?? "");
		setRepoSelection(
			compose.owner && compose.repository ? `${compose.owner}/${compose.repository}` : "",
		);
		setBranch(compose.branch ?? "");
		setComposePath(compose.composePath);
		setProviderId(
			compose.githubId ?? compose.gitlabId ?? compose.bitbucketId ?? compose.giteaId ?? "",
		);
	}, [compose]);

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

	const updateMutation = useMutation(
		trpc.compose.update.mutationOptions({
			onSuccess: () => {
				toast.success("Compose service updated");
				queryClient.invalidateQueries({
					queryKey: trpc.compose.one.queryKey({ composeId: compose.composeId }),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

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
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">General</CardTitle>
					<CardDescription>How this compose file is deployed.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-6">
					<div className="flex flex-col gap-2">
						<Label htmlFor="compose-type">Compose Type</Label>
						<Select
							value={composeType}
							onValueChange={(value) => setComposeType(value as ComposeService["composeType"])}
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
							<code>docker compose up</code>.
						</p>
					</div>
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div>
							<Label htmlFor="isolated-deployment">Isolated Deployment</Label>
							<p className="text-sm text-muted-foreground">
								Randomize service and container names to avoid collisions between copies of this
								compose file.
							</p>
						</div>
						<Switch
							id="isolated-deployment"
							checked={isolatedDeployment}
							onCheckedChange={setIsolatedDeployment}
						/>
					</div>
					<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
						<div>
							<Label htmlFor="auto-deploy">Auto Deploy</Label>
							<p className="text-sm text-muted-foreground">
								Deploy automatically when the source repository changes.
							</p>
						</div>
						<Switch id="auto-deploy" checked={autoDeploy} onCheckedChange={setAutoDeploy} />
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Source</CardTitle>
					<CardDescription>Where the compose file comes from.</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="source-type">Source Type</Label>
						<Select
							value={sourceType}
							onValueChange={(value) => setSourceType(value as SourceType)}
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
							The compose file is stored directly on this service. Edit it in the{" "}
							<span className="font-medium">Compose File</span> tab.
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
									onChange={(e) => setGitUrl(e.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="git-branch">Branch</Label>
								<Input
									id="git-branch"
									placeholder="main"
									value={gitBranch}
									onChange={(e) => setGitBranch(e.target.value)}
								/>
							</div>
						</>
					)}

					{isGitProviderSource(sourceType) && (
						<>
							<div className="flex flex-col gap-2">
								<Label htmlFor="provider">Provider</Label>
								<Select value={providerId} onValueChange={setProviderId}>
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
										Settings → Git Providers.
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

					{sourceType !== "raw" && (
						<div className="flex flex-col gap-2">
							<Label htmlFor="compose-path">Compose Path</Label>
							<Input
								id="compose-path"
								placeholder="./docker-compose.yml"
								value={composePath}
								onChange={(e) => setComposePath(e.target.value)}
							/>
						</div>
					)}

					<div className="flex justify-end">
						<Button onClick={onSave} disabled={updateMutation.isPending}>
							{updateMutation.isPending ? "Saving…" : "Save"}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
