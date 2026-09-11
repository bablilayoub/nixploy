"use client";

import { formatDateTime, formatRelative } from "@/lib/format";

/**
 * `<time>` with the absolute timestamp as its `title` and machine-readable
 * `dateTime`. Lists read relative ("3 hours ago"); details read absolute.
 * Both texts depend on the viewer's clock and timezone, so hydration
 * warnings are suppressed for this element only.
 */
export function DateTime({
	value,
	mode = "relative",
	className,
}: {
	value: Date | string | number;
	mode?: "relative" | "absolute";
	className?: string;
}) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return <span className={className}>—</span>;
	}
	const absolute = formatDateTime(date);
	return (
		<time
			dateTime={date.toISOString()}
			title={absolute}
			className={className}
			suppressHydrationWarning
		>
			{mode === "relative" ? formatRelative(date) : absolute}
		</time>
	);
}
