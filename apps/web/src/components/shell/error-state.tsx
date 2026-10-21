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
	title = "This page failed to load",
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
		<div className="mx-auto flex min-h-[65vh] max-w-2xl flex-col items-start justify-center gap-5 px-6 py-12">
			<div className="flex size-12 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5">
				<AlertTriangle className="size-6 text-destructive" />
			</div>
			<div className="flex flex-col gap-3">
				<h1 className="text-3xl leading-tight font-semibold tracking-[-0.035em]">{title}</h1>
				<p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
			</div>
			{error.message && (
				<p className="max-w-xl break-words rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
					{error.message}
				</p>
			)}
			{error.digest && <p className="font-mono text-xs text-muted-foreground">{error.digest}</p>}
			<div className="flex flex-wrap items-center gap-2">
				{reset && (
					<Button onClick={reset} size="sm">
						<RotateCcw className="size-4" />
						Try again
					</Button>
				)}
				<Button asChild variant="outline" size="sm">
					<Link href={homeHref}>{homeHref === "/" ? "Go home" : "Back to dashboard"}</Link>
				</Button>
			</div>
		</div>
	);
}
