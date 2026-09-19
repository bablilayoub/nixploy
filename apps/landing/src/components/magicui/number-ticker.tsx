"use client";

import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { type ComponentPropsWithoutRef, useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

/*
 * Spring-animated number that counts once when it scrolls into view.
 * Changed from upstream: the SSR text is the *formatted* startValue (upstream printed the raw
 * number, so "1000" reflowed to "1,000" on hydration), and the hardcoded black/white default is
 * gone — `cn` has no tailwind-merge here, so a colour default could not be overridden.
 * Under reduced motion the spring never runs: the final number is written to the DOM on mount.
 */

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
	const reduceMotion = useReducedMotion();
	const finalValue = direction === "down" ? startValue : value;

	const formatter = useMemo(
		() =>
			new Intl.NumberFormat("en-US", {
				minimumFractionDigits: decimalPlaces,
				maximumFractionDigits: decimalPlaces,
			}),
		[decimalPlaces],
	);

	// Written to the DOM rather than rendered, so the server HTML and the first
	// client paint stay the formatted startValue and hydration still matches.
	useEffect(() => {
		if (!reduceMotion) return;
		const node = ref.current;
		if (!node) return;
		node.textContent = formatter.format(Number(finalValue.toFixed(decimalPlaces)));
	}, [reduceMotion, finalValue, formatter, decimalPlaces]);

	useEffect(() => {
		if (reduceMotion) return;
		let timer: ReturnType<typeof setTimeout> | null = null;

		if (isInView) {
			timer = setTimeout(() => {
				motionValue.set(finalValue);
			}, delay * 1000);
		}

		return () => {
			if (timer !== null) {
				clearTimeout(timer);
			}
		};
	}, [motionValue, isInView, delay, finalValue, reduceMotion]);

	useEffect(() => {
		if (reduceMotion) return;
		return springValue.on("change", (latest) => {
			if (ref.current) {
				ref.current.textContent = formatter.format(Number(latest.toFixed(decimalPlaces)));
			}
		});
	}, [springValue, formatter, decimalPlaces, reduceMotion]);

	return (
		<span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
			{formatter.format(Number(startValue.toFixed(decimalPlaces)))}
		</span>
	);
}
