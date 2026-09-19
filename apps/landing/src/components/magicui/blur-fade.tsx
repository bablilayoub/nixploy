"use client";

/**
 * Entrance wrapper: translate + blur + fade, optionally on scroll into view.
 * Changed from upstream: honours prefers-reduced-motion. Motion writes inline
 * styles, so a CSS media query cannot reach it — instead we swap in variants
 * that hold the final state (opacity only, no transform, no blur) and a
 * zero-length transition, keeping the same element and class names.
 */

import {
	AnimatePresence,
	type MotionProps,
	motion,
	type UseInViewOptions,
	useInView,
	useReducedMotion,
	type Variants,
} from "motion/react";
import { useRef } from "react";

type MarginType = UseInViewOptions["margin"];

interface BlurFadeProps extends MotionProps {
	children: React.ReactNode;
	className?: string;
	variant?: { hidden: { y: number }; visible: { y: number } };
	duration?: number;
	delay?: number;
	offset?: number;
	direction?: "up" | "down" | "left" | "right";
	inView?: boolean;
	inViewMargin?: MarginType;
	blur?: string;
}

const staticVariants: Variants = {
	hidden: { opacity: 1 },
	visible: { opacity: 1 },
};

export function BlurFade({
	children,
	className,
	variant,
	duration = 0.4,
	delay = 0,
	offset = 6,
	direction = "down",
	inView = false,
	inViewMargin = "-50px",
	blur = "6px",
	...props
}: BlurFadeProps) {
	const ref = useRef(null);
	const inViewResult = useInView(ref, { once: true, margin: inViewMargin });
	const isInView = !inView || inViewResult;
	const reduced = useReducedMotion() === true;
	const defaultVariants: Variants = {
		hidden: {
			[direction === "left" || direction === "right" ? "x" : "y"]:
				direction === "right" || direction === "down" ? -offset : offset,
			opacity: 0,
			filter: `blur(${blur})`,
		},
		visible: {
			[direction === "left" || direction === "right" ? "x" : "y"]: 0,
			opacity: 1,
			filter: "blur(0px)",
		},
	};
	const combinedVariants = reduced ? staticVariants : (variant ?? defaultVariants);

	return (
		<AnimatePresence>
			<motion.div
				ref={ref}
				initial={reduced ? false : "hidden"}
				animate={reduced || isInView ? "visible" : "hidden"}
				exit="hidden"
				variants={combinedVariants}
				transition={reduced ? { duration: 0 } : { delay: 0.04 + delay, duration, ease: "easeOut" }}
				className={className}
				{...props}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}
