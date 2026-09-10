"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Cycles through `words` with a vertical flip; width is reserved for the longest word. */
export function WordRotate({
	words,
	className,
	interval = 2400,
}: {
	words: readonly string[];
	className?: string;
	interval?: number;
}) {
	const [index, setIndex] = useState(0);

	useEffect(() => {
		const id = window.setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
		return () => window.clearInterval(id);
	}, [interval, words.length]);

	return (
		<span className={cn("relative inline-grid overflow-hidden align-bottom", className)}>
			{/* Invisible copy of the longest word keeps the line from reflowing. */}
			<span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden>
				{words.reduce((a, b) => (a.length >= b.length ? a : b))}
			</span>
			<AnimatePresence mode="popLayout" initial={false}>
				<motion.span
					key={words[index]}
					initial={{ y: "100%", opacity: 0 }}
					animate={{ y: 0, opacity: 1 }}
					exit={{ y: "-100%", opacity: 0 }}
					transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
					className="col-start-1 row-start-1 whitespace-nowrap"
				>
					{words[index]}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
