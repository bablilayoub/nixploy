"use client";

import type { ComponentProps } from "react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * SubNav-style underline tab chrome for state-based tab sets. Mirrors the
 * look of the link-based SubNav in @/components/shell on top of the radix
 * Tabs primitives, so tabs that swap local state match tabs that route.
 */
export function UnderlineTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
	return (
		<TabsList
			variant="line"
			className={cn(
				// Narrow screens scroll the strip; `scroll-shadow-x` is the only hint
				// that there are more tabs off the edge (the scrollbar itself is
				// hidden — it sat on top of the active underline).
				"no-scrollbar scroll-shadow-x h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0",
				className,
			)}
			{...props}
		/>
	);
}

export function UnderlineTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
	return (
		<TabsTrigger
			className={cn(
				"-mb-px h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2 text-sm font-normal text-muted-foreground shadow-none transition-colors after:hidden hover:text-foreground data-[state=active]:border-b-brand data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none",
				className,
			)}
			{...props}
		/>
	);
}
