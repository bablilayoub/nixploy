"use client";

import { DeploymentHistory } from "@/components/services/deployment-history";

import type { Application } from "./types";

export function DeploymentsTab({ application }: { application: Application }) {
	return (
		<DeploymentHistory
			kind="application"
			serviceId={application.applicationId}
			description="Build and deployment history for this application."
			canCancel
		/>
	);
}
