import React, { type ComponentPropsWithoutRef, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

export interface ShimmerButtonProps extends ComponentPropsWithoutRef<"span"> {
	shimmerColor?: string;
	shimmerSize?: string;
	borderRadius?: string;
	shimmerDuration?: string;
	background?: string;
	className?: string;
	children?: React.ReactNode;
}

/** Visual CTA chrome — wrap with Link/a for navigation (avoids button-in-link). */
export const ShimmerButton = React.forwardRef<HTMLSpanElement, ShimmerButtonProps>(
	(
		{
			shimmerColor = "#ffffff",
			shimmerSize = "0.05em",
			shimmerDuration = "3s",
			borderRadius = "8px",
			background = "rgba(255, 255, 255, 1)",
			className,
			children,
			...props
		},
		ref,
	) => {
		return (
			<span
				style={
					{
						"--spread": "90deg",
						"--shimmer-color": shimmerColor,
						"--radius": borderRadius,
						"--speed": shimmerDuration,
						"--cut": shimmerSize,
						"--bg": background,
					} as CSSProperties
				}
				className={cn(
					"group relative z-0 inline-flex cursor-pointer items-center justify-center overflow-hidden [border-radius:var(--radius)] border border-white/10 px-6 py-3 whitespace-nowrap text-black [background:var(--bg)]",
					"transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px",
					className,
				)}
				ref={ref}
				{...props}
			>
				<span className={cn("-z-30 blur-[2px]", "absolute inset-0 overflow-visible")}>
					<span className="animate-shimmer-slide absolute inset-0 aspect-square h-[100cqh] [mask:none]">
						<span className="animate-spin-around absolute -inset-full w-auto rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
					</span>
				</span>
				{children}
				<span
					className={cn(
						"absolute inset-0 size-full rounded-lg px-4 py-1.5 text-sm font-medium shadow-[inset_0_-8px_10px_#0000001f]",
						"transform-gpu transition-all duration-300 ease-in-out",
						"group-hover:shadow-[inset_0_-6px_10px_#0000003f]",
						"group-active:shadow-[inset_0_-10px_10px_#0000003f]",
					)}
				/>
				<span className="absolute inset-(--cut) -z-20 [border-radius:var(--radius)] [background:var(--bg)]" />
			</span>
		);
	},
);

ShimmerButton.displayName = "ShimmerButton";
