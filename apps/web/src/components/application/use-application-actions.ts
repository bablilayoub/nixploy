"use client";

import { useFollowDeployment } from "@/hooks/use-running-deployments";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

/**
 * Lifecycle mutations of one application, shared by the header buttons and
 * the runtime empty states (Deploy / Start CTA) so both use the same toasts,
 * invalidation and pending state. A queued deploy is "followed":
 * the page switches to the Deployments tab and opens that row's log drawer.
 */
export function useApplicationActions({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const followDeployment = useFollowDeployment();

	const invalidate = [
		trpc.application.one.queryKey({ applicationId }),
		trpc.application.all.pathKey(),
		trpc.deployment.byApplication.pathKey(),
		// Wakes the shared running-deployments query (hairline, header, services table).
		trpc.deployment.recent.pathKey(),
	];

	// `followDeployment` stays inside `mutationOptions` so the log drawer opens
	// as soon as the job is queued, without waiting for the invalidations.
	const follow = (result: { deploymentId: string }) => followDeployment(result.deploymentId);

	const deploy = useSaveMutation(trpc.application.deploy.mutationOptions({ onSuccess: follow }), {
		successMessage: "Deployment queued",
		invalidate,
	});
	const start = useSaveMutation(trpc.application.start.mutationOptions(), {
		successMessage: "Application started",
		invalidate,
	});
	const stop = useSaveMutation(trpc.application.stop.mutationOptions(), {
		successMessage: "Application stopped",
		invalidate,
	});

	const isBusy = deploy.isPending || start.isPending || stop.isPending;

	return { deploy, start, stop, isBusy };
}

export type ApplicationActions = ReturnType<typeof useApplicationActions>;
