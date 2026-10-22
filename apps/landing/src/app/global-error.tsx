"use client";
import { useStandaloneTheme } from "@/lib/use-standalone-theme";
import "./globals.css";
export default function GlobalError({ reset }: { reset: () => void }) {
	useStandaloneTheme("dark");
	return (
		<html lang="en">
			<body>
				<main className="mx-auto flex min-h-svh max-w-xl flex-col items-start justify-center gap-5 px-6 py-16">
					<p className="signal-kicker">Nixploy</p>
					<h1 className="text-4xl leading-tight font-semibold tracking-tight">
						This page could not load.
					</h1>
					<p className="text-base leading-relaxed text-muted-foreground">
						Try again to reload the site.
					</p>
					<button
						type="button"
						onClick={reset}
						className="min-h-11 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
					>
						Try again
					</button>
				</main>
			</body>
		</html>
	);
}
