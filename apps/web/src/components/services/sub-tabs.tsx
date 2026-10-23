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
				"h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0",
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
				"h-8 flex-none rounded-md border border-transparent bg-transparent px-2.5 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-none",
				className,
			)}
			{...props}
		/>
	);
}
