"use client";

import { BitbucketPanel } from "@/components/settings/git-providers/bitbucket-panel";
import { GiteaPanel } from "@/components/settings/git-providers/gitea-panel";
import { GithubPanel } from "@/components/settings/git-providers/github-panel";
import { GitlabPanel } from "@/components/settings/git-providers/gitlab-panel";
import { PageHeader } from "@/components/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function GitProvidersView() {
	return (
		<div className="flex flex-col gap-4">
			<PageHeader
				title="Git Providers"
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
