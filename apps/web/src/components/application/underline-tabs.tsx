"use client";

import { type ComponentProps, useEffect, useId } from "react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Stock line-variant tabs with selected-tab visibility and keyboard scroll
 * behavior retained for long service navigation.
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
		window.addEventListener("resize", schedule);
		void document.fonts.ready.then(schedule);
		document.fonts.addEventListener("loadingdone", schedule);
		schedule();
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			selection.disconnect();
			resize.disconnect();
			window.removeEventListener("resize", schedule);
			document.fonts.removeEventListener("loadingdone", schedule);
		};
	}, [listId]);

	return (
		<TabsList
			id={listId}
			variant="line"
			className={cn("w-full max-w-full justify-start overflow-x-auto", className)}
			{...props}
		/>
	);
}

export function UnderlineTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
	return <TabsTrigger className={cn("flex-none", className)} {...props} />;
}
