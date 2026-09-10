"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Container, SectionHeading } from "@/components/ui";
import { faqs } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

export function Faq() {
	const [open, setOpen] = useState<number | null>(0);

	return (
		<section id="faq" className="border-t border-border py-20 sm:py-28">
			<Container className="max-w-3xl">
				<BlurFade inView>
					<SectionHeading eyebrow="FAQ" title="Questions people ask before they curl." />
				</BlurFade>
				<ul className="mt-10 divide-y divide-border border-y border-border">
					{faqs.map((item, i) => {
						const isOpen = open === i;
						return (
							<li key={item.q}>
								<button
									type="button"
									className="flex w-full items-center justify-between gap-4 py-5 text-left"
									onClick={() => setOpen(isOpen ? null : i)}
									aria-expanded={isOpen}
								>
									<span className="font-display text-base font-medium text-foreground sm:text-lg">
										{item.q}
									</span>
									<ChevronDown
										className={cn(
											"size-5 shrink-0 text-muted-2 transition-transform",
											isOpen && "rotate-180 text-accent",
										)}
									/>
								</button>
								<div
									className={cn(
										"grid transition-[grid-template-rows] duration-300",
										isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
									)}
								>
									<div className="overflow-hidden">
										<p className="pb-5 text-sm leading-relaxed text-muted">{item.a}</p>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			</Container>
		</section>
	);
}
