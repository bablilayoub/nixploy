"use client";

import { useEffect, useRef, useState } from "react";

import type { Tone } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

type Line = { text: string; tone: Tone };

const toneClass: Record<Tone, string> = {
	cmd: "c-cmd",
	dim: "c-dim",
	ok: "c-ok",
};

/**
 * Terminal that "types" the first line and then reveals the rest one per
 * tick, looping forever. Starts when scrolled into view; respects
 * prefers-reduced-motion by rendering everything at once.
 */
export function TypingTerminal({
	lines,
	title = "deploy log",
	className,
}: {
	lines: readonly Line[];
	title?: string;
	className?: string;
}) {
	const [typed, setTyped] = useState(0);
	const [shown, setShown] = useState(0);
	const [reduced, setReduced] = useState(false);
	const [active, setActive] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(mq.matches);
		const node = ref.current;
		if (!node) return;
		const io = new IntersectionObserver(([entry]) => setActive(Boolean(entry?.isIntersecting)), {
			threshold: 0.3,
		});
		io.observe(node);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		if (reduced || !active) return;
		const first = lines[0]?.text ?? "";
		let timer: number;
		if (typed < first.length) {
			timer = window.setTimeout(() => setTyped((t) => t + 1), 28);
		} else if (shown < lines.length - 1) {
			timer = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 500 : 650);
		} else {
			timer = window.setTimeout(() => {
				setTyped(0);
				setShown(0);
			}, 4200);
		}
		return () => window.clearTimeout(timer);
	}, [typed, shown, lines, reduced, active]);

	const first = lines[0];
	const done = reduced || typed >= (first?.text.length ?? 0);
	const visible = reduced ? lines.length - 1 : shown;

	return (
		<div
			ref={ref}
			className={cn("overflow-hidden rounded-xl border border-border bg-[#0c0e12]", className)}
		>
			<div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
				<span className="size-2.5 rounded-full bg-[#ff5f57]" />
				<span className="size-2.5 rounded-full bg-[#febc2e]" />
				<span className="size-2.5 rounded-full bg-[#28c840]" />
				<span className="ml-3 font-mono text-[11px] text-muted-2">{title}</span>
			</div>
			<div className="code min-h-[13.5rem] space-y-1.5 p-4 sm:p-5">
				{first ? (
					<p className={cn(toneClass[first.tone], !done && "caret")}>
						{reduced ? first.text : first.text.slice(0, typed)}
					</p>
				) : null}
				{lines.slice(1, visible + 1).map((line) => (
					<p key={line.text} className={toneClass[line.tone]}>
						{line.text}
					</p>
				))}
			</div>
		</div>
	);
}
