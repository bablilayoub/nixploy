"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { buildCommitUrl, DeploymentHistory } from "@/components/services/deployment-history";

export function DeploymentsTab({ compose }: { compose: ComposeService }) {
	return (
		<DeploymentHistory
			kind="compose"
			serviceId={compose.composeId}
			description="Build and deployment history for this compose service."
			// `compose.one` carries no gitlab/gitea relation, so self-hosted
			// providers have no base URL here and their shas stay plain text.
			commitUrl={(sha) =>
				buildCommitUrl(
					{
						sourceType: compose.sourceType,
						owner: compose.owner,
						repository: compose.repository,
						gitUrl: compose.gitUrl,
					},
					sha,
				)
			}
		/>
	);
}
