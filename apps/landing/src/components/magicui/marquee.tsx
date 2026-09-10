import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Infinite horizontal marquee. Children are duplicated so the loop is
 * seamless; pass `reverse` for the opposite direction and `pauseOnHover`.
 */
export function Marquee({
	children,
	className,
	reverse = false,
	pauseOnHover = true,
	duration = "70s",
}: {
	children: ReactNode;
	className?: string;
	reverse?: boolean;
	pauseOnHover?: boolean;
	duration?: string;
}) {
	return (
		<div
			className={cn("marquee-mask group flex overflow-hidden [--gap:1rem]", className)}
			style={{ "--duration": duration } as React.CSSProperties}
		>
			{[0, 1].map((copy) => (
				<div
					key={copy}
					aria-hidden={copy === 1}
					className={cn(
						"animate-marquee flex shrink-0 items-center gap-[var(--gap)] pr-[var(--gap)]",
						reverse && "[animation-direction:reverse]",
						pauseOnHover && "group-hover:[animation-play-state:paused]",
					)}
				>
					{children}
				</div>
			))}
		</div>
	);
}
