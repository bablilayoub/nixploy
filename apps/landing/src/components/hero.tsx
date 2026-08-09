"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Safari } from "@/components/magicui/safari";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { site } from "@/lib/site";

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-20">
			<div className="relative mx-auto max-w-6xl px-5 sm:px-6">
				<div className="max-w-3xl">
					<BlurFade delay={0.05}>
						<a
							href={site.github}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white"
						>
							Open source · Apache-2.0
							<ArrowRight className="size-3" />
						</a>
					</BlurFade>

					<BlurFade delay={0.12}>
						<h1 className="mt-6 font-display text-4xl font-semibold tracking-tight text-balance text-white sm:text-6xl lg:text-7xl">
							Deploy anything to your own servers.
						</h1>
					</BlurFade>

					<BlurFade delay={0.2}>
						<p className="mt-6 max-w-2xl text-lg leading-relaxed text-neutral-400 sm:text-xl">
							Nixploy turns any Docker host into a full deployment platform. Push from Git and get
							builds, TLS domains, databases with backups, and live monitoring — without the per-app
							cloud bill.
						</p>
					</BlurFade>

					<BlurFade delay={0.28}>
						<div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
							<Link href="/docs/install">
								<ShimmerButton className="h-11 gap-2 px-6 text-sm font-medium">
									Install Nixploy <ArrowRight className="size-4" />
								</ShimmerButton>
							</Link>
							<InstallCommand className="w-full sm:max-w-md" />
						</div>
					</BlurFade>

					<BlurFade delay={0.34}>
						<p className="mt-5 text-sm text-neutral-500">
							Runs anywhere Docker runs. Five databases, seven service types, 86 one-click
							templates.
						</p>
					</BlurFade>
				</div>

				<BlurFade delay={0.4} className="relative mt-14 sm:mt-16">
					<div className="relative">
						<Safari imageSrc="/screenshots/02-dashboard.png" url="panel.nixploy.local" />
						<BorderBeam size={120} duration={10} colorFrom="#ffffff" colorTo="#525252" />
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
