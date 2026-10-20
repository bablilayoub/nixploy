"use client";

import type { ComponentProps } from "react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Secondary tab strip for nested groups (Runtime → Logs / Monitoring / Terminal).
 * Quieter than the primary underline bar so two levels don’t compete.
 */
export function SubTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
	return (
		<TabsList
			className={cn(
				"h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto",
				className,
			)}
			{...props}
		/>
	);
}

export function SubTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
	return (
		<TabsTrigger
			className={cn(
				"h-9 flex-none rounded-md border border-transparent bg-transparent px-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-panel-inset hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-control data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-none",
				className,
			)}
			{...props}
		/>
	);
}
