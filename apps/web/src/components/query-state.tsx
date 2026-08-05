"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
				<div className="divide-y rounded-xl border">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			)
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
				<AlertTriangle className="size-8 text-muted-foreground" />
				<p className="text-sm font-medium">Failed to load</p>
				{error?.message && <p className="text-sm text-muted-foreground">{error.message}</p>}
				{onRetry && (
					<Button variant="outline" size="sm" onClick={onRetry}>
						Retry
					</Button>
				)}
			</div>
		);
	}

	if (isEmpty) {
		return <>{empty}</>;
	}

	return <>{children}</>;
}
