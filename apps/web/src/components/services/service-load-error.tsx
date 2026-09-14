"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/services/empty-state";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/describe-error";

/**
 * A service page that could not load. Two different situations look the same
 * from here and must not be answered the same way: the service is gone (a
 * stale bookmark, a deleted app, someone else's id — retrying will never
 * help), or the panel could not be reached (retrying is exactly right).
 *
 * Either way there is a way out: the dead end used to offer a Retry button
 * that could not succeed and no link back.
 */
export function ServiceLoadError({
	label,
	projectId,
	error,
	onRetry,
}: {
	/** "Application", "Compose service", "PostgreSQL" — what was being opened. */
	label: string;
	projectId: string;
	error: unknown;
	onRetry: () => void;
}) {
	const status = (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
	// 4xx will answer the same on every retry; only offer it for the rest.
	const retryable = typeof status !== "number" || status >= 500;
	const missing = !error || status === 404;

	return (
		<EmptyState
			icon={AlertTriangle}
			title={missing ? `${label} not found` : `Could not load this ${label.toLowerCase()}`}
			description={
				missing ? "It may have been deleted, or you don't have access to it." : describeError(error)
			}
			action={
				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button asChild variant="outline" size="sm">
						<Link href={`/dashboard/projects/${projectId}`}>Back to project</Link>
					</Button>
					{retryable && !missing && (
						<Button variant="outline" size="sm" onClick={onRetry}>
							Retry
						</Button>
					)}
				</div>
			}
		/>
	);
}
