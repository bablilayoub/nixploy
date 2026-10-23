"use client";

import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Explains a disabled control. Disabled buttons swallow pointer events, so a
 * `title` never shows in most browsers and touch has no hover at all — wrap
 * the control in a focusable span that carries a tooltip instead (the shadcn
 * pattern). Renders the children untouched when there is no hint, so callers
 * can pass the same `hint` they would have put in `title`.
 */
export function DisabledHint({
	hint,
	children,
	className,
}: {
	hint?: string | null;
	children: ReactNode;
	className?: string;
}) {
	// `className` carries layout the control needs in both states (e.g. the
	// header's `hidden sm:inline-flex`), so it stays on a wrapper even without
	// a hint — a bare fragment would drop it for users who can act.
	if (!hint) {
		return className ? <span className={cn("inline-flex", className)}>{children}</span> : children;
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					// biome-ignore lint/a11y/noNoninteractiveTabindex: focusable tooltip trigger standing in for the disabled control (shadcn pattern)
					tabIndex={0}
					className={cn("inline-flex rounded-md [&>*]:pointer-events-none", className)}
				>
					{children}
				</span>
			</TooltipTrigger>
			<TooltipContent>{hint}</TooltipContent>
		</Tooltip>
	);
}
