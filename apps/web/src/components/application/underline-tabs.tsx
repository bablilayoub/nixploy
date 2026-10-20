"use client";

import { type ComponentProps, useEffect, useId } from "react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * SubNav-style underline tab chrome for state-based tab sets. Mirrors the
 * look of the link-based SubNav in @/components/shell on top of the radix
 * Tabs primitives, so tabs that swap local state match tabs that route.
 */
export function UnderlineTabsList({ className, id, ...props }: ComponentProps<typeof TabsList>) {
	const generatedId = useId();
	const listId = id ?? generatedId;

	useEffect(() => {
		const list = document.getElementById(listId);
		if (!(list instanceof HTMLElement)) return;
		let disposed = false;
		let frame = 0;
		let previousSelected: HTMLElement | null = null;
		const reveal = () => {
			if (disposed || list.clientWidth === 0) return;
			const selected = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
			const selectionChanged = selected !== previousSelected;
			previousSelected = selected;
			if (!selected) return;
			const focus = document.activeElement;
			const focusedTab =
				focus instanceof HTMLElement &&
				focus.getAttribute("role") === "tab" &&
				focus.closest('[role="tablist"]') === list
					? focus
					: null;
			// URL/selection changes reveal the newly selected tab. Geometry-only
			// checks preserve manual keyboard navigation before Enter activates it.
			const target = selectionChanged ? selected : (focusedTab ?? selected);
			const bounds = list.getBoundingClientRect();
			const trigger = target.getBoundingClientRect();
			const left = bounds.left + list.clientLeft;
			const right = left + list.clientWidth;
			const delta =
				trigger.width > list.clientWidth
					? getComputedStyle(list).direction === "rtl"
						? trigger.right - right
						: trigger.left - left
					: trigger.left < left
						? trigger.left - left
						: trigger.right > right
							? trigger.right - right
							: 0;
			// Use physical deltas without assuming an absolute RTL scrollLeft value.
			// Scroll only this strip; scrollIntoView could move the document or focus.
			if (Math.abs(delta) > 0.5) list.scrollBy({ left: delta, top: 0, behavior: "instant" });
		};
		const schedule = () => {
			if (disposed || frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				reveal();
			});
		};
		const selection = new MutationObserver(schedule);
		selection.observe(list, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["aria-selected", "data-state", "dir"],
		});
		const resize = new ResizeObserver(schedule);
		resize.observe(list);
		void document.fonts.ready.then(schedule);
		document.fonts.addEventListener("loadingdone", schedule);
		schedule();
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			selection.disconnect();
			resize.disconnect();
			document.fonts.removeEventListener("loadingdone", schedule);
		};
	}, [listId]);

	return (
		<TabsList
			id={listId}
			variant="line"
			className={cn(
				// Narrow screens scroll the strip; `scroll-shadow-x` is the only hint
				// that there are more tabs off the edge (the scrollbar itself is
				// hidden — it sat on top of the active underline).
				"no-scrollbar scroll-shadow-x h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-0 border-b bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto",
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
				"-mb-px min-h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-normal text-muted-foreground shadow-none transition-colors after:hidden hover:bg-panel-inset hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:border-b-brand data-[state=active]:bg-selection data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none",
				className,
			)}
			{...props}
		/>
	);
}
