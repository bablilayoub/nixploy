"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Container } from "@/components/ui";
import { faqs } from "@/lib/landing-data";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

export function Faq() {
	const [open, setOpen] = useState<number | null>(0);

	return (
		<section id="faq" className="py-16 sm:py-24">
			<Container>
				<div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
					<BlurFade inView>
						<h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
							Got questions?
						</h2>
						<p className="mt-3 text-sm text-muted sm:text-base">
							Still curious?{" "}
							<a
								href={`mailto:${site.email}`}
								className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
							>
								Reach out directly
							</a>{" "}
							or open an issue on GitHub.
						</p>
					</BlurFade>
					<ul className="divide-y divide-border border-y border-border">
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
										<span className="text-sm font-medium text-foreground sm:text-base">
											{item.q}
										</span>
										<Plus
											className={cn(
												"size-4 shrink-0 text-muted-2 transition-transform",
												isOpen && "rotate-45 text-foreground",
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
				</div>
			</Container>
		</section>
	);
}
