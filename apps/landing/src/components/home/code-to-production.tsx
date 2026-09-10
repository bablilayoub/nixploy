"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { GithubIcon } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Container } from "@/components/ui";
import { steps } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

function ConnectCard() {
	return (
		<div className="relative">
			<div className="halo" aria-hidden />
			<div className="relative overflow-hidden rounded-2xl border border-border-strong bg-surface p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] sm:p-8">
				<div className="flex items-center justify-center gap-4">
					<span className="grid size-12 place-items-center rounded-xl border border-border bg-surface-2">
						<LogoMark className="size-7" />
					</span>
					<span className="h-px w-10 bg-border-strong" />
					<span className="grid size-12 place-items-center rounded-xl border border-border bg-surface-2 text-foreground">
						<GithubIcon className="size-6" />
					</span>
				</div>
				<h3 className="mt-6 text-center font-display text-lg font-semibold text-foreground">
					Connect Nixploy to GitHub
				</h3>
				<p className="mx-auto mt-2 max-w-xs text-center text-sm text-muted">
					Install the GitHub App once. Every repository you pick deploys on push.
				</p>
				<div className="mt-6 space-y-3 text-sm">
					<div>
						<p className="mb-1.5 text-xs text-muted-2">Repository</p>
						<div className="rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[13px] text-foreground/80">
							acme/api
						</div>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div>
							<p className="mb-1.5 text-xs text-muted-2">Branch</p>
							<div className="rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[13px] text-foreground/80">
								main
							</div>
						</div>
						<div>
							<p className="mb-1.5 text-xs text-muted-2">Builder</p>
							<div className="rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[13px] text-foreground/80">
								nixpacks
							</div>
						</div>
					</div>
					<div className="mt-2 rounded-full bg-foreground py-2.5 text-center text-sm font-medium text-background">
						Deploy
					</div>
				</div>
			</div>
		</div>
	);
}

export function CodeToProduction() {
	const [open, setOpen] = useState(0);

	return (
		<section id="how-it-works" className="py-16 sm:py-24">
			<Container>
				<div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
					<BlurFade inView>
						<ConnectCard />
					</BlurFade>
					<BlurFade inView delay={0.1}>
						<h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
							From code
							<br />
							to production
						</h2>
						<ol className="mt-8 divide-y divide-border border-y border-border">
							{steps.map((step, i) => {
								const isOpen = open === i;
								return (
									<li key={step.title}>
										<button
											type="button"
											onClick={() => setOpen(isOpen ? -1 : i)}
											aria-expanded={isOpen}
											className="flex w-full items-center justify-between gap-4 py-4 text-left"
										>
											<span className="text-sm font-medium text-foreground sm:text-base">
												<span className="mr-3 font-mono text-xs text-muted-2">Step {i + 1}</span>
												{step.title}
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
												<p className="pb-5 text-sm leading-relaxed text-muted">{step.body}</p>
											</div>
										</div>
									</li>
								);
							})}
						</ol>
					</BlurFade>
				</div>
			</Container>
		</section>
	);
}
