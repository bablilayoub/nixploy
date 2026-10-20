"use client";

import { useRunningDeployments } from "@/hooks/use-running-deployments";

/**
 * 1px indeterminate progress hairline pinned directly under the TopNav
 * border while any deployment is queued or running. Reads the shared
 * running-deployments query (polls only while something is in flight —
 * no more 5 s forever polling on every page). Pure neutral CSS animation
 * (keyframes kept inline so no global stylesheet change is needed).
 */
export function DeployProgressBar() {
	const { anyActive } = useRunningDeployments();

	if (!anyActive) {
		return null;
	}

	return (
		<div aria-hidden className="fixed inset-x-0 top-14 z-40 h-px overflow-hidden bg-border">
			<style>
				{`@keyframes nixploy-deploy-sweep {
	from { transform: translateX(-100%); }
	to { transform: translateX(400%); }
}`}
			</style>
			<div
				className="h-full w-1/4 bg-foreground/60"
				style={{ animation: "nixploy-deploy-sweep 1.2s linear infinite" }}
			/>
		</div>
	);
}
