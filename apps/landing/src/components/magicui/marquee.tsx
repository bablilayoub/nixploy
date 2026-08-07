import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
	className?: string;
	reverse?: boolean;
	pauseOnHover?: boolean;
	children: React.ReactNode;
	repeat?: number;
}

export function Marquee({
	className,
	reverse = false,
	pauseOnHover = false,
	children,
	repeat = 4,
	...props
}: MarqueeProps) {
	const tracks = Array.from({ length: repeat }, (_, i) => `marquee-track-${i}`);

	return (
		<div
			{...props}
			className={cn(
				"group flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] gap-(--gap)",
				className,
			)}
		>
			{tracks.map((id) => (
				<div
					key={id}
					className={cn("flex shrink-0 justify-around gap-(--gap) animate-marquee flex-row", {
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
