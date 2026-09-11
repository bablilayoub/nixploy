"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/lib/trpc";

/**
 * 1px indeterminate progress hairline pinned directly under the TopNav
 * border while any deployment is queued or running. Pure neutral CSS
 * animation (keyframes kept inline so no global stylesheet change is needed).
 */
export function DeployProgressBar() {
	const trpc = useTRPC();
	const { data } = useQuery({
		...trpc.deployment.recent.queryOptions({ limit: 5 }),
		refetchInterval: 5_000,
	});
	const active = (data?.deployments ?? []).some(
		(deployment) => deployment.status === "running" || deployment.status === "queued",
	);

	if (!active) {
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
