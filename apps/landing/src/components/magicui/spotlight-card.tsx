"use client";

import { type MouseEvent, type ReactNode, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Card with a soft radial highlight that follows the pointer. Pure CSS
 * variables, no re-renders per move.
 */
export function SpotlightCard({
	children,
	className,
	as: Tag = "div",
}: {
	children: ReactNode;
	className?: string;
	as?: "div" | "li" | "article";
}) {
	const ref = useRef<HTMLElement>(null);

	function onMove(event: MouseEvent<HTMLElement>) {
		const node = ref.current;
		if (!node) return;
		const rect = node.getBoundingClientRect();
		node.style.setProperty("--x", `${event.clientX - rect.left}px`);
		node.style.setProperty("--y", `${event.clientY - rect.top}px`);
	}

	return (
		<Tag
			// biome-ignore lint/suspicious/noExplicitAny: polymorphic ref
			ref={ref as any}
			onMouseMove={onMove}
			className={cn(
				"card card-hover group relative overflow-hidden [--x:50%] [--y:50%]",
				"before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300 before:content-[''] group-hover:before:opacity-100 hover:before:opacity-100",
				"before:[background:radial-gradient(360px_circle_at_var(--x)_var(--y),rgba(242,181,61,0.10),transparent_60%)]",
				className,
			)}
		>
			{children}
		</Tag>
	);
}
