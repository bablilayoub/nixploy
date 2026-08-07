import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
	className?: string;
	reverse?: boolean;
	pauseOnHover?: boolean;
	children: React.ReactNode;
	vertical?: boolean;
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
	const tracks = Array.from({ length: repeat }, (_, i) => `marquee-${i}`);

	return (
		<div
			{...props}
			className={cn(
				"group flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem]",
				vertical ? "flex-col" : "flex-row",
				className,
			)}
		>
			{tracks.map((id) => (
				<div
					key={id}
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
