"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/shell";

export default function RootError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return <ErrorState error={error} reset={reset} homeHref="/" />;
}
