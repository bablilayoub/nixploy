"use client";

import { buildCommitUrl, DeploymentHistory } from "@/components/services/deployment-history";

import { DeployCommandsCard } from "./deploy-commands-card";
import { DeployHookCard } from "./deploy-hook-card";

import type { Application } from "./types";

export function DeploymentsTab({ application }: { application: Application }) {
	return (
		<div className="space-y-6">
			<details id="deployment-automation" className="group rounded-xl border bg-card">
				<summary className="cursor-pointer rounded-xl px-5 py-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
					Deployment automation
					<span className="ml-2 font-normal text-muted-foreground">Commands and deploy hook</span>
				</summary>
				<div className="border-t px-5 py-5 sm:px-6">
					<DeployCommandsCard application={application} />
					<DeployHookCard appName={application.appName} />
				</div>
			</details>
			<DeploymentHistory
				kind="application"
				serviceId={application.applicationId}
				description="Build and deployment history for this application."
				canCancel
				commitUrl={(sha) =>
					buildCommitUrl(
						{
							sourceType: application.sourceType,
							owner: application.owner,
							repository: application.repository,
							gitUrl: application.gitUrl,
							providerUrl: application.gitlab?.gitlabUrl ?? application.gitea?.giteaUrl ?? null,
						},
						sha,
					)
				}
			/>
		</div>
	);
}
