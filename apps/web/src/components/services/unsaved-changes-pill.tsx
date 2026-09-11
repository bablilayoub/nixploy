"use client";

import { CircleDot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { cn } from "@/lib/utils";

/**
 * "Unsaved changes" pill for per-card forms. Renders next to the Save button
 * while `dirty` and registers the form with the navigation guard
 * (`useUnsavedChanges`), so wiring a form is this single element.
 */
export function UnsavedChangesPill({ dirty, className }: { dirty: boolean; className?: string }) {
	useUnsavedChanges(dirty);
	if (!dirty) return null;
	return (
		<Badge variant="warning" className={cn("gap-1", className)} role="status">
			<CircleDot className="size-3" aria-hidden />
			Unsaved changes
		</Badge>
	);
}
