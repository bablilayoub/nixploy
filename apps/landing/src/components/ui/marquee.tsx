"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
	/**
	 * Optional CSS class name to apply custom styles
	 */
	className?: string;
	/**
	 * Whether to reverse the animation direction
	 * @default false
	 */
	reverse?: boolean;
	/**
	 * Whether to pause the animation on hover
	 * @default false
	 */
	pauseOnHover?: boolean;
	/**
	 * Content to be displayed in the marquee
	 */
	children: React.ReactNode;
	/**
	 * Whether to animate vertically instead of horizontally
	 * @default false
	 */
	vertical?: boolean;
	/**
	 * Number of times to repeat the content
	 * @default 4
	 */
	repeat?: number;
}

export function Marquee({
	className,
	reverse = false,
	pauseOnHover = false,
	children,
	vertical = false,
	repeat = 4,
	...props
}: MarqueeProps) {
	const rootRef = useRef<HTMLDivElement>(null);

	/*
	 * Take the duplicate copies out of the tab order. They are `aria-hidden`,
	 * and a focusable element inside an `aria-hidden` subtree is announced as
	 * nothing at all; this is the other half of that.
	 */
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		for (const copy of root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')) {
			for (const el of copy.querySelectorAll<HTMLElement>("a, button, [tabindex]")) {
				el.tabIndex = -1;
			}
		}
	}, []);

	return (
		<div
			{...props}
			ref={rootRef}
			className={cn(
				"group flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem]",
				{
					"flex-row": !vertical,
					"flex-col": vertical,
				},
				className,
			)}
		>
			{Array(repeat)
				.fill(0)
				.map((_, i) => (
					<div
						key={i}
						// Copies after the first exist to make the loop seamless: the
						// same content again. They are hidden from assistive technology
						// and their links are taken out of the tab order by the effect
						// above — `inert` would do both but also swallows clicks, and a
						// card the reader can see should stay clickable.
						aria-hidden={i > 0 ? true : undefined}
						className={cn("flex shrink-0 justify-around gap-(--gap)", {
							"animate-marquee flex-row": !vertical,
							"animate-marquee-vertical flex-col": vertical,
							"group-hover:[animation-play-state:paused]": pauseOnHover,
							"[animation-direction:reverse]": reverse,
						})}
					>
						{children}
					</div>
				))}
		</div>
	);
}
