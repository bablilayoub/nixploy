"use client";

import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MagicCard({
	children,
	className,
	gradientSize = 220,
	gradientColor = "#262626",
	gradientOpacity = 0.7,
	gradientFrom = "#ffffff",
	gradientTo = "#525252",
}: {
	children?: ReactNode;
	className?: string;
	gradientSize?: number;
	gradientColor?: string;
	gradientOpacity?: number;
	gradientFrom?: string;
	gradientTo?: string;
}) {
	const mouseX = useMotionValue(-gradientSize);
	const mouseY = useMotionValue(-gradientSize);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			const rect = e.currentTarget.getBoundingClientRect();
			mouseX.set(e.clientX - rect.left);
			mouseY.set(e.clientY - rect.top);
		},
		[mouseX, mouseY],
	);

	const reset = useCallback(() => {
		mouseX.set(-gradientSize);
		mouseY.set(-gradientSize);
	}, [gradientSize, mouseX, mouseY]);

	return (
		<motion.div
			className={cn(
				"group relative isolate overflow-hidden rounded-[inherit] border border-transparent",
				className,
			)}
			onPointerMove={handlePointerMove}
			onPointerLeave={reset}
			style={{
				background: useMotionTemplate`
          linear-gradient(#0a0a0a 0 0) padding-box,
          radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
            ${gradientFrom},
            ${gradientTo},
            #262626 100%
          ) border-box
        `,
			}}
		>
			<div className="absolute inset-px z-20 rounded-[inherit] bg-[#0a0a0a]" />
			<motion.div
				className="pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
				style={{
					background: useMotionTemplate`
            radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
              ${gradientColor},
              transparent 100%
            )
          `,
					opacity: gradientOpacity,
				}}
			/>
			<div className="relative z-40">{children}</div>
		</motion.div>
	);
}
