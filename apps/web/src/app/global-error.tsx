"use client";

import { useEffect } from "react";
import { useStandaloneTheme } from "@/lib/use-standalone-theme";
import "./globals.css";

/**
 * Last-resort boundary: replaces the root layout, so it must render its own
 * <html>/<body> and cannot rely on providers, fonts or theme context.
 */
export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useStandaloneTheme();
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<html lang="en">
			<body className="font-sans antialiased">
				<main className="mx-auto flex min-h-svh max-w-xl flex-col items-start justify-center gap-5 px-6">
					<p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
						Application error
					</p>
					<h1 className="text-3xl leading-tight font-semibold tracking-tight">
						Nixploy failed to load
					</h1>
					<p className="max-w-md text-sm leading-relaxed text-muted-foreground">
						The application crashed before it could render. Check the Nixploy server logs for the
						matching error.
					</p>
					{error.digest && (
						<p className="font-mono text-xs text-muted-foreground">{error.digest}</p>
					)}
					<button
						type="button"
						onClick={reset}
						className="min-h-11 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
					>
						Try again
					</button>
				</main>
			</body>
		</html>
	);
}
