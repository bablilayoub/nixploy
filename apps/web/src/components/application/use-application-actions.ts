"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "@/lib/trpc";

/**
 * Lifecycle mutations of one application, shared by the header buttons and
 * the runtime empty states (Deploy / Start CTA) so both use the same toasts,
 * invalidation and pending state.
 */
export function useApplicationActions({
	applicationId,
	onDeployQueued,
}: {
	applicationId: string;
	/** A deploy/redeploy was queued — the page uses it to poll `application.one` for a while. */
	onDeployQueued?: () => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: trpc.application.one.queryKey({ applicationId }),
		});
		queryClient.invalidateQueries({ queryKey: trpc.application.all.pathKey() });
		queryClient.invalidateQueries({
			queryKey: trpc.deployment.byApplication.pathKey(),
		});
	};

	const onError = (error: { message: string }) => toast.error(error.message);

	const deploy = useMutation(
		trpc.application.deploy.mutationOptions({
			onSuccess: () => {
				toast.success("Deployment queued");
				onDeployQueued?.();
				invalidate();
			},
			onError,
		}),
	);
	const redeploy = useMutation(
		trpc.application.redeploy.mutationOptions({
			onSuccess: () => {
				toast.success("Redeployment queued");
				onDeployQueued?.();
				invalidate();
			},
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
