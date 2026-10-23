"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Shared surface for App Router `error.tsx` boundaries. Shows the digest
 * rather than the raw stack — server error messages are redacted in
 * production builds anyway, and the digest is what correlates with the
 * server log line.
 */
export function ErrorState({
	title = "Something went wrong",
	description = "This page failed to render. Retrying usually resolves it; if it does not, check the Nixploy server logs.",
	error,
	reset,
	homeHref = "/dashboard",
}: {
	title?: string;
	description?: string;
	error: Error & { digest?: string };
	reset?: () => void;
	homeHref?: string;
}) {
	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
				<AlertTriangle className="size-6 text-destructive" />
			</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-lg font-semibold">{title}</h1>
				<p className="max-w-md text-sm text-muted-foreground">{description}</p>
			</div>
			{error.message && (
				<p className="max-w-xl break-words rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
					{error.message}
				</p>
			)}
			{error.digest && <p className="font-mono text-xs text-muted-foreground">{error.digest}</p>}
			<div className="flex items-center gap-2">
				{reset && (
					<Button onClick={reset} size="sm">
						<RotateCcw className="size-4" />
						Try again
					</Button>
				)}
				<Button asChild variant="outline" size="sm">
					<Link href={homeHref}>Back to dashboard</Link>
				</Button>
			</div>
		</div>
	);
}
