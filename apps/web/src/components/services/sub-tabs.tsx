"use client";

import type { ComponentProps } from "react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Standard shadcn segmented tabs for nested service workspaces. */
export function SubTabsList({ className, ...props }: ComponentProps<typeof TabsList>) {
	return <TabsList className={cn("h-auto max-w-full justify-start", className)} {...props} />;
}
export function SubTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
	return <TabsTrigger className={cn("min-h-8 flex-none", className)} {...props} />;
}
