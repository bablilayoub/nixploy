"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { DeploymentHistory } from "@/components/services/deployment-history";

export function DeploymentsTab({ compose }: { compose: ComposeService }) {
	return (
		<DeploymentHistory
			kind="compose"
			serviceId={compose.composeId}
			description="Build and deployment history for this compose service."
		/>
	);
}
