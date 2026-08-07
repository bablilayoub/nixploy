import type { ComponentPropsWithoutRef, CSSProperties, FC } from "react";

import { cn } from "@/lib/utils";

export interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<"span"> {
	shimmerWidth?: number;
}

export const AnimatedShinyText: FC<AnimatedShinyTextProps> = ({
	children,
	className,
	shimmerWidth = 100,
	...props
}) => {
	return (
		<span
			style={{ "--shiny-width": `${shimmerWidth}px` } as CSSProperties}
			className={cn(
				"mx-auto max-w-md text-neutral-400/80",
				"animate-shiny-text bg-size-[var(--shiny-width)_100%] bg-clip-text bg-position-[0_0] bg-no-repeat [transition:background-position_1s_cubic-bezier(.6,.6,0,1)_infinite]",
				"bg-linear-to-r from-transparent via-white/80 via-50% to-transparent",
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
};
