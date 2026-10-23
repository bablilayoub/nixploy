"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/describe-error";

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
		<Empty role="alert" className="border bg-card">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<AlertTriangle aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				{message && <EmptyDescription>{message}</EmptyDescription>}
			</EmptyHeader>
			{onRetry && (
				<EmptyContent>
					<Button variant="outline" size="sm" onClick={onRetry}>
						Retry
					</Button>
				</EmptyContent>
			)}
		</Empty>
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
			<div role="status" aria-label="Loading content" aria-busy="true">
				{skeleton ?? (
					<div className="divide-y rounded-lg border">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				)}
			</div>
		);
	}

	if (isError) {
		return <LoadError message={error ? describeError(error) : undefined} onRetry={onRetry} />;
	}

	if (isEmpty) {
		return <>{empty}</>;
	}

	return <>{children}</>;
}
