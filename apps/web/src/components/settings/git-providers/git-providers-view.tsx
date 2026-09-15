"use client";

import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { BitbucketPanel } from "@/components/settings/git-providers/bitbucket-panel";
import { GiteaPanel } from "@/components/settings/git-providers/gitea-panel";
import { GithubPanel } from "@/components/settings/git-providers/github-panel";
import { GitlabPanel } from "@/components/settings/git-providers/gitlab-panel";
import { PageHeader } from "@/components/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSyncedTab } from "@/hooks/use-synced-tab";
import { useTRPC } from "@/lib/trpc";

const PROVIDER_TABS = ["github", "gitlab", "bitbucket", "gitea"] as const;

export function GitProvidersView() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	// The tab belongs in the URL like every other tabbed surface here, so a
	// deep link or a refresh does not drop you back on GitHub.
	const [tab, selectTab] = useSyncedTab("github", (value) =>
		PROVIDER_TABS.includes(value as (typeof PROVIDER_TABS)[number]),
	);

	// Counts on the triggers: otherwise the only way to see which providers are
	// connected is to click all four. The panels run the same queries, so this
	// shares their cache rather than adding round trips.
	const counts = useQueries({
		queries: [
			trpc.github.all.queryOptions(),
			trpc.gitlab.all.queryOptions(),
			trpc.bitbucket.all.queryOptions(),
			trpc.gitea.all.queryOptions(),
		],
		combine: (results) =>
			Object.fromEntries(
				PROVIDER_TABS.map((name, index) => [name, results[index]?.data?.length ?? 0]),
			) as Record<(typeof PROVIDER_TABS)[number], number>,
	});

	const syncInstallation = useMutation(trpc.github.syncInstallation.mutationOptions());

	useEffect(() => {
		const connected = searchParams.get("github");
		const githubError = searchParams.get("githubError");
		// The App manifest sets `setup_url` to this page, so GitHub lands here
		// after the operator installs the App. Sync the installation id right
		// away instead of leaving them to find the refresh button.
		const setupAction = searchParams.get("setup_action");
		if (setupAction === "install" || setupAction === "update") {
			void (async () => {
				const rows = await queryClient.fetchQuery(trpc.github.all.queryOptions()).catch(() => null);
				const target =
					rows?.find(({ github }) => !github.githubInstallationId) ?? rows?.[rows.length - 1];
				if (!target) return;
				try {
					await syncInstallation.mutateAsync({ githubId: target.github.githubId });
					toast.success("GitHub App installed");
				} catch (error) {
					toast.error(error instanceof Error ? error.message : "Could not sync the installation");
				}
				void queryClient.invalidateQueries({ queryKey: trpc.github.all.queryKey() });
			})();
			router.replace("/dashboard/settings/git-providers");
			return;
		}
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
	}, [searchParams, router, queryClient, trpc.github.all, syncInstallation.mutateAsync]);

	return (
		<div className="flex flex-col gap-4">
			<PageHeader
				title="Git providers"
				description="Connect GitHub, GitLab, Bitbucket, or Gitea for repository deploys."
			/>
			<Tabs value={tab} onValueChange={selectTab}>
				<TabsList>
					{(
						[
							["github", "GitHub"],
							["gitlab", "GitLab"],
							["bitbucket", "Bitbucket"],
							["gitea", "Gitea"],
						] as const
					).map(([value, label]) => (
						<TabsTrigger key={value} value={value}>
							{label}
							{counts[value] > 0 ? (
								<span className="ms-1.5 tabular-nums text-muted-foreground">{counts[value]}</span>
							) : null}
						</TabsTrigger>
					))}
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
