"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { type KeyboardEvent, useId, useRef, useState } from "react";

import { Container, SectionTitle, TerminalFrame } from "@/components/ui";
import { screens } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

/*
 * The panel in tabs: one window, six captures, a row of chips above it.
 * The chips follow the tabs pattern (arrow keys move, only the current one
 * is in the tab order) and a change is a 200ms crossfade over a box that
 * keeps the capture's 16:10, so the page never jumps while an image loads.
 * Under reduced motion the swap is immediate.
 */
export function Screens() {
	const [index, setIndex] = useState(0);
	const reduced = useReducedMotion() === true;
	const baseId = useId();
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const active = screens[index] ?? screens[0];
	const panelId = `${baseId}-panel`;
	const tabId = (id: string) => `${baseId}-tab-${id}`;

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const targets: Record<string, number> = {
			ArrowRight: index + 1,
			ArrowLeft: index - 1,
			Home: 0,
			End: screens.length - 1,
		};
		const target = targets[event.key];
		if (target === undefined) return;
		event.preventDefault();
		const next = (target + screens.length) % screens.length;
		setIndex(next);
		tabRefs.current[next]?.focus();
	}

	return (
		<section className="py-24 lg:py-32">
			<Container>
				<SectionTitle title="One panel for the whole box">
					Projects, deployments, runtime, Docker and the template catalog, on one screen you host
					yourself.
				</SectionTitle>

				<div
					role="tablist"
					aria-label="Panel screens"
					onKeyDown={onKeyDown}
					className="mt-12 flex flex-wrap justify-center gap-1"
				>
					{screens.map((screen, i) => {
						const selected = i === index;
						return (
							<button
								key={screen.id}
								type="button"
								role="tab"
								id={tabId(screen.id)}
								aria-selected={selected}
								aria-controls={panelId}
								tabIndex={selected ? 0 : -1}
								ref={(el) => {
									tabRefs.current[i] = el;
								}}
								onClick={() => setIndex(i)}
								className={cn(
									"h-10 rounded-full px-4 text-small font-medium transition-colors max-sm:h-11",
									selected ? "bg-surface-3 text-foreground" : "text-muted hover:text-foreground",
								)}
							>
								{screen.label}
							</button>
						);
					})}
				</div>

				<div className="mx-auto mt-6 max-w-[1120px]">
					<TerminalFrame title={active.label} tag="panel" bodyClassName="p-0">
						<div
							role="tabpanel"
							id={panelId}
							aria-labelledby={tabId(active.id)}
							className="relative aspect-[16/10]"
						>
							<AnimatePresence initial={false}>
								<motion.div
									key={active.id}
									className="absolute inset-0"
									initial={reduced ? false : { opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
								>
									<Image
										src={active.src}
										alt={active.alt}
										width={3200}
										height={2000}
										sizes="(min-width:1200px) 1120px, 100vw"
										className="h-auto w-full"
									/>
								</motion.div>
							</AnimatePresence>
						</div>
					</TerminalFrame>
				</div>
			</Container>
		</section>
	);
}
