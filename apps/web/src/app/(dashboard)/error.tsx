"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/shell";

/**
 * Dashboard-scoped boundary: keeps the shell (top nav, org switcher) mounted
 * so a failing page does not take the whole app down.
 */
export default function DashboardError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return <ErrorState error={error} reset={reset} />;
}
