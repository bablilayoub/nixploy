"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { BitbucketPanel } from "@/components/settings/git-providers/bitbucket-panel";
import { GiteaPanel } from "@/components/settings/git-providers/gitea-panel";
import { GithubPanel } from "@/components/settings/git-providers/github-panel";
import { GitlabPanel } from "@/components/settings/git-providers/gitlab-panel";
import { PageHeader } from "@/components/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";

export function GitProvidersView() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	useEffect(() => {
		const connected = searchParams.get("github");
		const githubError = searchParams.get("githubError");
		if (!connected && !githubError) return;

		if (connected === "connected") {
			toast.success("GitHub App connected");
			void queryClient.invalidateQueries({ queryKey: trpc.github.all.queryKey() });
		} else if (githubError) {
			toast.error(
				githubError === "missing_code" || githubError === "missing_state"
					? "GitHub App setup was cancelled or incomplete"
					: githubError,
			);
		}

		router.replace("/dashboard/settings/git-providers");
	}, [searchParams, router, queryClient, trpc.github.all]);

	return (
		<div className="flex flex-col gap-4">
			<PageHeader
				title="Git providers"
				description="Connect GitHub, GitLab, Bitbucket, or Gitea for repository deploys."
			/>
			<Tabs defaultValue="github">
				<TabsList>
					<TabsTrigger value="github">GitHub</TabsTrigger>
					<TabsTrigger value="gitlab">GitLab</TabsTrigger>
					<TabsTrigger value="bitbucket">Bitbucket</TabsTrigger>
					<TabsTrigger value="gitea">Gitea</TabsTrigger>
				</TabsList>
				<TabsContent value="github" className="mt-4">
					<GithubPanel />
				</TabsContent>
				<TabsContent value="gitlab" className="mt-4">
					<GitlabPanel />
				</TabsContent>
				<TabsContent value="bitbucket" className="mt-4">
					<BitbucketPanel />
				</TabsContent>
				<TabsContent value="gitea" className="mt-4">
					<GiteaPanel />
				</TabsContent>
			</Tabs>
		</div>
	);
}
