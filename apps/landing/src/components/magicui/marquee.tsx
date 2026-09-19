import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Infinite scrolling row (or column) of repeated children — magicui's marquee.
 * Speed and gap are props instead of the upstream `[--duration:40s]` utility
 * class: our `cn` has no tailwind-merge, so a caller's class cannot reliably
 * beat a hardcoded one. Needs the `marquee` / `marquee-vertical` keyframes.
 */

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
	className?: string;
	/** Reverse the scroll direction. */
	reverse?: boolean;
	/** Freeze the animation while the pointer is over the marquee. */
	pauseOnHover?: boolean;
	children: ReactNode;
	/** Scroll top-to-bottom instead of left-to-right. */
	vertical?: boolean;
	/** How many times the children are cloned to fill the track. */
	repeat?: number;
	/** One full loop, as a CSS duration. */
	duration?: string;
	/** Space between items, as a CSS length. */
	gap?: string;
}

export function Marquee({
	className,
	reverse = false,
	pauseOnHover = false,
	children,
	vertical = false,
	repeat = 4,
	duration = "40s",
	gap = "1rem",
	style,
	...props
}: MarqueeProps) {
	const tracks = Array.from({ length: repeat }, (_, index) => `track-${index}`);

	return (
		<div
			{...props}
			style={{ "--duration": duration, "--gap": gap, ...style } as CSSProperties}
			className={cn(
				// `relative` is load-bearing: without it Chromium adds the clipped
				// tracks to the page's scroll width and the viewport scrolls sideways.
				"group relative flex gap-(--gap) overflow-hidden",
				{
					"flex-row": !vertical,
					"flex-col": vertical,
				},
				className,
			)}
		>
			{tracks.map((track, index) => (
				<div
					key={track}
					// Only the first copy is real: the clones exist to make the loop
					// seamless and must not repeat every link to a screen reader or Tab.
					aria-hidden={index > 0 ? true : undefined}
					inert={index > 0 ? true : undefined}
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
