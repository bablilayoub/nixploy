"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

/** Library empty-state composition shared by App Router error boundaries. */
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
		<Empty className="min-h-[65vh]">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<AlertTriangle aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>
					<h1>{title}</h1>
				</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				{error.message && (
					<p role="alert" className="max-w-full break-words text-sm text-muted-foreground">
						{error.message}
					</p>
				)}
				{error.digest && <Badge variant="secondary">{error.digest}</Badge>}
				<div className="flex flex-wrap justify-center gap-2">
					{reset && (
						<Button onClick={reset}>
							<RotateCcw aria-hidden="true" />
							Try again
						</Button>
					)}
					<Button asChild variant="outline">
						<Link href={homeHref}>{homeHref === "/" ? "Go home" : "Back to dashboard"}</Link>
					</Button>
				</div>
			</EmptyContent>
		</Empty>
	);
}
