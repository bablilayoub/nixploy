"use client";

import { useInView, useMotionValue, useSpring } from "motion/react";
import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
	value: number;
	startValue?: number;
	direction?: "up" | "down";
	delay?: number;
	decimalPlaces?: number;
}

export function NumberTicker({
	value,
	startValue = 0,
	direction = "up",
	delay = 0,
	className,
	decimalPlaces = 0,
	...props
}: NumberTickerProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const motionValue = useMotionValue(direction === "down" ? value : startValue);
	const springValue = useSpring(motionValue, {
		damping: 60,
		stiffness: 100,
	});
	const isInView = useInView(ref, { once: true, margin: "0px" });

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;

		if (isInView && ref.current) {
			ref.current.textContent = Intl.NumberFormat("en-US", {
				minimumFractionDigits: decimalPlaces,
				maximumFractionDigits: decimalPlaces,
			}).format(direction === "down" ? value : startValue);
		}

		if (isInView) {
			timer = setTimeout(() => {
				motionValue.set(direction === "down" ? startValue : value);
			}, delay * 1000);
		}

		return () => {
			if (timer !== null) {
				clearTimeout(timer);
			}
		};
	}, [motionValue, isInView, delay, value, direction, startValue, decimalPlaces]);

	useEffect(
		() =>
			springValue.on("change", (latest) => {
				if (ref.current) {
					ref.current.textContent = Intl.NumberFormat("en-US", {
						minimumFractionDigits: decimalPlaces,
						maximumFractionDigits: decimalPlaces,
					}).format(Number(latest.toFixed(decimalPlaces)));
				}
			}),
		[springValue, decimalPlaces],
	);

	const formatted = Intl.NumberFormat("en-US", {
		minimumFractionDigits: decimalPlaces,
		maximumFractionDigits: decimalPlaces,
	}).format(value);

	return (
		<span
			ref={ref}
			className={cn(
				"inline-block tracking-wider text-black tabular-nums dark:text-white",
				className,
			)}
			{...props}
		>
			{/* The final figure, not `startValue`: this is the server-rendered
			    text, and a page that says "0 templates" to a crawler or to a
			    reader with scripts off is wrong. The effect below replaces it
			    when the animation runs. */}
			{formatted}
		</span>
	);
}
