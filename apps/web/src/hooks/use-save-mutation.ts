"use client";

import type { QueryKey, UseMutationOptions, UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { toastError } from "@/lib/describe-error";

export interface SaveMutationConfig<TData = unknown, TVariables = unknown> {
	/** Sentence-case confirmation, e.g. "Resources updated". Omit for silent saves. */
	successMessage?: string;
	/** Query keys to invalidate once the mutation resolves (in parallel). */
	invalidate?: QueryKey[];
	/** Runs after the toast and the invalidations — typically `draft.markSaved`. */
	onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
	/** Fallback text when the error carries no readable message. */
	errorMessage?: string;
}

/**
 * `useMutation` for the "edit a form, press Save" shape that ~40 panel
 * components used to hand-roll: success toast (sentence case), `toastError`
 * on failure, keyed invalidations, `isPending` for the button.
 *
 * ```tsx
 * const save = useSaveMutation(trpc.application.update.mutationOptions(), {
 *   successMessage: "Resources updated",
 *   invalidate: [trpc.application.one.queryKey({ applicationId })],
 *   onSuccess: draft.markSaved,
 * });
 * ```
 *
 * Callbacks passed inside `options` still run (before the toast for success,
 * before `toastError` for failure), so a form can keep a router push or an
 * extra cache write next to the shared plumbing.
 */
export function useSaveMutation<TData, TError, TVariables, TContext>(
	options: UseMutationOptions<TData, TError, TVariables, TContext>,
	config: SaveMutationConfig<TData, TVariables> = {},
): UseMutationResult<TData, TError, TVariables, TContext> {
	const queryClient = useQueryClient();
	const { successMessage, invalidate, onSuccess, errorMessage } = config;

	return useMutation({
		...options,
		onSuccess: async (
			...args: Parameters<NonNullable<typeof options.onSuccess>>
		): Promise<unknown> => {
			const [data, variables] = args;
			await options.onSuccess?.(...args);
			if (successMessage) toast.success(successMessage);
			if (invalidate && invalidate.length > 0) {
				await Promise.all(
					invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
				);
			}
			await onSuccess?.(data, variables);
			return undefined;
		},
		onError: (...args: Parameters<NonNullable<typeof options.onError>>): unknown => {
			const [error] = args;
			options.onError?.(...args);
			toastError(error, errorMessage);
			return undefined;
		},
	});
}
