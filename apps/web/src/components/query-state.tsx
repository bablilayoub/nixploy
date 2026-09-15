"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The "could not load this" block, on its own so surfaces that do their own
 * fetching (better-auth calls, panels with bespoke retry) look identical to the
 * ones wrapped in `QueryState` — a dozen of them had hand-rolled this with
 * different padding, a different radius and no icon.
 */
export function LoadError({
	title = "Failed to load",
	message,
	onRetry,
}: {
	title?: string;
	message?: string | null;
	onRetry?: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
			<AlertTriangle className="mb-1 size-8 text-muted-foreground" />
			<p className="text-sm font-medium">{title}</p>
			{message ? <p className="max-w-sm text-sm text-muted-foreground">{message}</p> : null}
			{onRetry ? (
				<Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
					Retry
				</Button>
			) : null}
		</div>
	);
}

export function QueryState({
	isPending,
	isError,
	error,
	onRetry,
	skeleton,
	isEmpty,
	empty,
	children,
}: {
	isPending: boolean;
	isError?: boolean;
	error?: { message?: string } | null;
	onRetry?: () => void;
	skeleton?: ReactNode;
	isEmpty: boolean;
	empty: ReactNode;
	children: ReactNode;
}) {
	if (isPending) {
		return (
			skeleton ?? (
				<div className="divide-y rounded-lg border">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			)
		);
	}

	if (isError) {
		return <LoadError message={error?.message} onRetry={onRetry} />;
	}

	if (isEmpty) {
		return <>{empty}</>;
	}

	return <>{children}</>;
}
