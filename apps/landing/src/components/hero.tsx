"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Safari } from "@/components/magicui/safari";
import { site } from "@/lib/site";

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-32 pb-12 sm:pt-40 sm:pb-20">
			<div
				className="pointer-events-none absolute inset-x-0 top-0 h-152 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.09),transparent_62%)]"
				aria-hidden
			/>
			<div className="relative mx-auto max-w-6xl px-5 text-center sm:px-6">
				<BlurFade delay={0.05} inView>
					<div className="mx-auto mb-7 flex max-w-fit items-center gap-2 rounded-full border border-white/10 bg-white/3 px-3 py-1.5 text-xs text-neutral-400">
						<span className="size-1.5 rounded-full bg-emerald-400" />
						Open source · Self-hosted PaaS
					</div>
				</BlurFade>

				<BlurFade delay={0.1} inView>
					<h1 className="mx-auto max-w-4xl text-balance text-5xl font-semibold tracking-[-0.06em] text-white sm:text-7xl">
						Your servers. <span className="text-neutral-500">Your PaaS.</span>
					</h1>
				</BlurFade>

				<BlurFade delay={0.2} inView>
					<p className="mx-auto mt-6 max-w-xl text-balance text-lg leading-relaxed text-neutral-400">
						Nixploy makes it simple to deploy applications, databases, and Docker Compose on
						infrastructure you already own.
					</p>
				</BlurFade>

				<BlurFade delay={0.3} inView>
					<div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Link
							href="/install"
							className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-5 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
						>
							Get started <ArrowRight className="size-4" />
						</Link>
						<a
							href={site.github}
							target="_blank"
							rel="noreferrer"
							className="inline-flex h-11 items-center rounded-md border border-white/15 px-5 text-sm font-medium text-white transition-colors hover:bg-white/5"
						>
							View on GitHub
						</a>
					</div>
				</BlurFade>

				<BlurFade delay={0.4} inView>
					<div className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-neutral-500">
						{["Git-based deploys", "Automatic SSL", "Docker native"].map((item) => (
							<span key={item} className="flex items-center gap-1.5">
								<Check className="size-3.5 text-neutral-300" />
								{item}
							</span>
						))}
					</div>
				</BlurFade>

				<BlurFade delay={0.45} inView>
					<div className="relative mx-auto mt-16 max-w-6xl">
						<div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#101010] shadow-[0_25px_90px_-30px_rgba(255,255,255,0.22)]">
							<BorderBeam size={90} duration={14} colorFrom="#ffffff" colorTo="#404040" />
							<Safari
								url="panel.nixploy.com"
								imageSrc="/screenshots/02-dashboard.png"
								className="size-full"
							/>
						</div>
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
