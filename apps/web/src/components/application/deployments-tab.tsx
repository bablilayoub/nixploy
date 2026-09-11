"use client";

import { buildCommitUrl, DeploymentHistory } from "@/components/services/deployment-history";

import { DeployHookCard } from "./deploy-hook-card";

import type { Application } from "./types";

export function DeploymentsTab({ application }: { application: Application }) {
	return (
		<div className="space-y-6">
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
			<DeployHookCard appName={application.appName} />
		</div>
	);
}
