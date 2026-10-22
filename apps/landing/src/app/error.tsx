"use client";

import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteNavbar } from "@/components/site-navbar";
import { Button } from "@/components/ui/button";

export default function LandingError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<>
			<SiteNavbar />
			<main
				id="main-content"
				className="container-page flex min-h-[70svh] flex-col items-start justify-center gap-5 pt-28 pb-16"
			>
				<p className="signal-kicker">Something interrupted this page</p>
				<h1 className="max-w-2xl text-5xl leading-tight font-medium tracking-[-0.04em]">
					Let’s try that again.
				</h1>
				<p className="max-w-lg text-base leading-relaxed text-muted-foreground">
					The page could not finish loading. Retry, or return home to find another way through.
				</p>
				{error.digest ? (
					<p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
				) : null}
				<div className="flex flex-wrap gap-3">
					<Button onClick={reset}>Retry page</Button>
					<Button asChild variant="outline">
						<Link href="/">Go home</Link>
					</Button>
				</div>
			</main>
			<SiteFooter />
		</>
	);
}
