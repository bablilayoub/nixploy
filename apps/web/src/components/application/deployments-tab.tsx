"use client";

import { buildCommitUrl, DeploymentHistory } from "@/components/services/deployment-history";

import type { Application } from "./types";

export function DeploymentsTab({ application }: { application: Application }) {
	return (
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
	);
}
