"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { type KeyboardEvent, useId, useRef, useState } from "react";

import { Container } from "@/components/ui";
import { screens } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

/*
 * The product window, directly under the fold — and the tabs live in the
 * window's own title bar rather than as a row of chips above it.
 *
 * That is the one structural joke on the page and it earns its place: the
 * chrome already looks like an application, so the captures read as one
 * application you are clicking through instead of six marketing images. It
 * also removes a whole section header from the top of the page, which is what
 * made the old fold scroll for two screens before saying anything.
 *
 * The chips follow the tabs pattern (arrow keys move, only the current one is
 * in the tab order) and a change is a 200ms crossfade over a box that keeps
 * the capture's 16:10, so the page never jumps while an image loads. Under
 * reduced motion the swap is immediate.
 */
export function Screens() {
	const [index, setIndex] = useState(0);
	const reduced = useReducedMotion() === true;
	const baseId = useId();
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	// `screens` is a const tuple, so the fallback is provably defined.
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
		<section id="panel" className="pt-16 pb-20 lg:pt-24 lg:pb-28">
			<Container>
				<div className="overflow-hidden rounded-2xl border border-border bg-background shadow-[0_48px_140px_-60px_#000]">
					<div className="flex h-14 items-center gap-3 border-b border-border bg-surface pr-3 pl-4">
						<span className="hidden w-[42px] shrink-0 gap-1.5 sm:flex" aria-hidden>
							<span className="size-2.5 rounded-full bg-border-strong" />
							<span className="size-2.5 rounded-full bg-border-strong" />
							<span className="size-2.5 rounded-full bg-border-strong" />
						</span>
						{/* The tab strip scrolls rather than wraps: a title bar that grows
						    a second row on a phone stops reading as a window. */}
						<div
							role="tablist"
							aria-label="Panel screens"
							onKeyDown={onKeyDown}
							className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,#000_92%,transparent)] [scrollbar-width:none] sm:[mask-image:none]"
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
											"inline-flex h-11 shrink-0 items-center rounded-full px-3.5 text-small font-medium transition-colors",
											selected
												? "bg-background text-foreground shadow-[0_0_0_1px_var(--color-border)]"
												: "text-muted hover:text-foreground",
										)}
									>
										{screen.label}
									</button>
								);
							})}
						</div>
						<span className="hidden shrink-0 font-mono text-micro text-muted-2 lg:inline">
							panel.acme.dev
						</span>
					</div>

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
									priority={active.id === screens[0].id}
									sizes="(min-width:1360px) 1280px, 100vw"
									className="h-auto w-full"
								/>
							</motion.div>
						</AnimatePresence>
					</div>
				</div>
			</Container>
		</section>
	);
}
