"use client";

import { useEffect } from "react";
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
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<html lang="en">
			<body className="font-sans antialiased">
				<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
					<h1 className="text-lg font-semibold">Nixploy failed to load</h1>
					<p className="max-w-md text-sm text-muted-foreground">
						The application crashed before it could render. Check the Nixploy server logs for the
						matching error.
					</p>
					{error.digest && (
						<p className="font-mono text-xs text-muted-foreground">{error.digest}</p>
					)}
					<button
						type="button"
						onClick={reset}
						className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
					>
						Try again
					</button>
				</div>
			</body>
		</html>
	);
}
