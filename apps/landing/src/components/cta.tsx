import Link from "next/link";

import { site } from "@/lib/site";

export function Cta() {
	return (
		<section className="border-t border-border py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 text-center sm:px-6">
				<h2 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">
					Install Nixploy today
				</h2>
				<p className="mx-auto mt-4 max-w-lg text-muted">
					One command on your server. Own the stack end to end.
				</p>
				<div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
					<Link
						href="/install"
						className="inline-flex h-11 items-center rounded-md bg-amber px-5 text-sm font-medium text-background transition-colors hover:bg-amber-soft"
					>
						Install guide
					</Link>
					<a
						href={site.github}
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-11 items-center rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
					>
						Star on GitHub
					</a>
				</div>
			</div>
		</section>
	);
}
