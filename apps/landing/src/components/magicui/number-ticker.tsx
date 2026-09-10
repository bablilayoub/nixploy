"use client";

import { animate, useInView } from "motion/react";
import { useEffect, useRef } from "react";

/** Counts from 0 to `value` when scrolled into view. */
export function NumberTicker({
	value,
	suffix = "",
	className,
}: {
	value: number;
	suffix?: string;
	className?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const inView = useInView(ref, { once: true, margin: "-10% 0px" });

	useEffect(() => {
		const node = ref.current;
		if (!node || !inView) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			node.textContent = `${value}${suffix}`;
			return;
		}
		const controls = animate(0, value, {
			duration: 1.4,
			ease: [0.22, 1, 0.36, 1],
			onUpdate: (latest) => {
				node.textContent = `${Math.round(latest)}${suffix}`;
			},
		});
		return () => controls.stop();
	}, [inView, value, suffix]);

	return (
		<span ref={ref} className={className}>
			0{suffix}
		</span>
	);
}
