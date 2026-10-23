"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useTRPC } from "@/lib/trpc";

export type GitProviderSourceType = "github" | "gitlab" | "bitbucket" | "gitea";

export const GIT_PROVIDER_LABELS: Record<GitProviderSourceType, string> = {
	github: "GitHub",
	gitlab: "GitLab",
	bitbucket: "Bitbucket",
	gitea: "Gitea",
};

type RepoOption = { key: string; value: string };

/**
 * Split an "owner/repository" selection into its parts. GitLab namespaces
 * may be nested ("group/sub/repo"), so the repository is the last segment
 * and the owner is everything before it — the same convention the webhook
 * handler and clone-url builders use.
 */
export function splitRepoSelection(selection: string): {
	owner: string;
	repository: string;
} {
	const index = selection.lastIndexOf("/");
	if (index === -1) {
		return { owner: "", repository: selection };
	}
	return { owner: selection.slice(0, index), repository: selection.slice(index + 1) };
}

/**
 * Repository + branch cascade for a configured git provider. Falls back to
 * free-text entry when no provider is selected or when the user toggles
 * "Enter manually" (e.g. the token cannot see the repository).
 */
export function GitProviderRepoPicker({
	sourceType,
	providerId,
	repoSelection,
	onRepoSelectionChange,
	branch,
	onBranchChange,
}: {
	sourceType: GitProviderSourceType;
	providerId: string;
	repoSelection: string;
	onRepoSelectionChange: (value: string) => void;
	branch: string;
	onBranchChange: (value: string) => void;
}) {
	const trpc = useTRPC();
	const [manualOverride, setManualOverride] = useState(false);
	const manual = !providerId || manualOverride;

	const githubRepos = useQuery(
		trpc.github.listRepositories.queryOptions(
			{ githubId: providerId },
			{ enabled: sourceType === "github" && !!providerId },
		),
	);
	const gitlabRepos = useQuery(
		trpc.gitlab.listRepositories.queryOptions(
			{ gitlabId: providerId },
			{ enabled: sourceType === "gitlab" && !!providerId },
		),
	);
	const bitbucketRepos = useQuery(
		trpc.bitbucket.listRepositories.queryOptions(
			{ bitbucketId: providerId },
			{ enabled: sourceType === "bitbucket" && !!providerId },
		),
	);
	const giteaRepos = useQuery(
		trpc.gitea.listRepositories.queryOptions(
			{ giteaId: providerId },
			{ enabled: sourceType === "gitea" && !!providerId },
		),
	);

	const repos: RepoOption[] | undefined = useMemo(() => {
		switch (sourceType) {
			case "github":
				return githubRepos.data?.map((repo) => ({
					key: String(repo.id),
					value: repo.fullName,
				}));
			case "gitlab":
				return gitlabRepos.data?.map((repo) => ({
					key: String(repo.id),
					value: repo.pathWithNamespace,
				}));
			case "bitbucket":
				return bitbucketRepos.data?.map((repo) => ({
					key: repo.uuid,
					value: repo.fullName,
				}));
			case "gitea":
				return giteaRepos.data?.map((repo) => ({
					key: String(repo.id),
					value: repo.fullName,
				}));
		}
	}, [sourceType, githubRepos.data, gitlabRepos.data, bitbucketRepos.data, giteaRepos.data]);

	const reposLoading =
		githubRepos.isLoading ||
		gitlabRepos.isLoading ||
		bitbucketRepos.isLoading ||
		giteaRepos.isLoading;
	const reposError =
		githubRepos.error ?? gitlabRepos.error ?? bitbucketRepos.error ?? giteaRepos.error;

	const { owner, repository } = splitRepoSelection(repoSelection);
	// Bitbucket's branch endpoint wants the repo slug, which can differ from
	// the name shown in full_name.
	const bitbucketSlug =
		bitbucketRepos.data?.find((repo) => repo.fullName === repoSelection)?.slug ?? repository;

	const branchEnabled = !manual && !!providerId && !!owner && !!repository;
	const githubBranches = useQuery(
		trpc.github.listBranches.queryOptions(
			{ githubId: providerId, owner, repo: repository },
			{ enabled: sourceType === "github" && branchEnabled },
		),
	);
	const gitlabBranches = useQuery(
		trpc.gitlab.listBranches.queryOptions(
			{ gitlabId: providerId, projectId: repoSelection },
			{ enabled: sourceType === "gitlab" && branchEnabled },
		),
	);
	const bitbucketBranches = useQuery(
		trpc.bitbucket.listBranches.queryOptions(
			{ bitbucketId: providerId, workspace: owner, repoSlug: bitbucketSlug },
			{ enabled: sourceType === "bitbucket" && branchEnabled && !!bitbucketSlug },
		),
	);
	const giteaBranches = useQuery(
		trpc.gitea.listBranches.queryOptions(
			{ giteaId: providerId, owner, repo: repository },
			{ enabled: sourceType === "gitea" && branchEnabled },
		),
	);

	const branches: string[] | undefined =
		sourceType === "github"
			? githubBranches.data
			: sourceType === "gitlab"
				? gitlabBranches.data
				: sourceType === "bitbucket"
					? bitbucketBranches.data
					: giteaBranches.data;
	const branchesLoading =
		githubBranches.isLoading ||
		gitlabBranches.isLoading ||
		bitbucketBranches.isLoading ||
		giteaBranches.isLoading;

	if (manual) {
		return (
			<div className="flex flex-col gap-2">
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<Label htmlFor="repo-path">Repository</Label>
						<Input
							id="repo-path"
							placeholder="owner/repository"
							value={repoSelection}
							onChange={(e) => onRepoSelectionChange(e.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="branch">Branch</Label>
						<Input
							id="branch"
							placeholder="main"
							value={branch}
							onChange={(e) => onBranchChange(e.target.value)}
						/>
					</div>
				</div>
				{providerId && (
					<button
						type="button"
						className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
						onClick={() => setManualOverride(false)}
					>
						Browse repositories instead
					</button>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-2">
					<Label>Repository</Label>
					<Select
						value={repoSelection}
						onValueChange={(value) => {
							onRepoSelectionChange(value);
							onBranchChange("");
						}}
						disabled={reposLoading || !!reposError}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={reposLoading ? "Loading…" : "Select a repository"} />
						</SelectTrigger>
						<SelectContent>
							{repos?.map((repo) => (
								<SelectItem key={repo.key} value={repo.value}>
									{repo.value}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-2">
					<Label>Branch</Label>
					<Select
						value={branch}
						onValueChange={onBranchChange}
						disabled={!repoSelection || branchesLoading}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={branchesLoading ? "Loading…" : "Select a branch"} />
						</SelectTrigger>
						<SelectContent>
							{branches?.map((b) => (
								<SelectItem key={b} value={b}>
									{b}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			{reposError ? (
				<p className="text-xs text-destructive">
					Couldn&apos;t load repositories: {reposError.message}
				</p>
			) : (
				!reposLoading &&
				repos?.length === 0 && (
					<p className="text-xs text-muted-foreground">
						No repositories visible to this provider&apos;s credentials.
					</p>
				)
			)}
			<button
				type="button"
				className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
				onClick={() => setManualOverride(true)}
			>
				Enter repository manually
			</button>
		</div>
	);
}
