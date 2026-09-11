"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFollowDeployment } from "@/hooks/use-running-deployments";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

/**
 * Lifecycle mutations of one application, shared by the header buttons and
 * the runtime empty states (Deploy / Start CTA) so both use the same toasts,
 * invalidation and pending state. A queued deploy/redeploy is "followed":
 * the page switches to the Deployments tab and opens that row's log drawer.
 */
export function useApplicationActions({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const followDeployment = useFollowDeployment();

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.application.one.queryKey({ applicationId }),
		});
		queryClient.invalidateQueries({ queryKey: trpc.application.all.pathKey() });
		queryClient.invalidateQueries({
			queryKey: trpc.deployment.byApplication.pathKey(),
		});
		// Wakes the shared running-deployments query (hairline, header, services table).
		queryClient.invalidateQueries({
			queryKey: trpc.deployment.recent.pathKey(),
		});
	};

	const onError = (error: { message: string }) => toastError(error);

	const queued = (message: string) => (result: { deploymentId: string }) => {
		toast.success(message);
		invalidate();
		followDeployment(result.deploymentId);
	};

	const deploy = useMutation(
		trpc.application.deploy.mutationOptions({
			onSuccess: queued("Deployment queued"),
			onError,
		}),
	);
	const redeploy = useMutation(
		trpc.application.redeploy.mutationOptions({
			onSuccess: queued("Redeployment queued"),
			onError,
		}),
	);
	const start = useMutation(
		trpc.application.start.mutationOptions({
			onSuccess: () => {
				toast.success("Application started");
				invalidate();
			},
			onError,
		}),
	);
	const stop = useMutation(
		trpc.application.stop.mutationOptions({
			onSuccess: () => {
				toast.success("Application stopped");
				invalidate();
			},
			onError,
		}),
	);

	const isBusy = deploy.isPending || redeploy.isPending || start.isPending || stop.isPending;

	return { deploy, redeploy, start, stop, isBusy };
}

export type ApplicationActions = ReturnType<typeof useApplicationActions>;
