"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { RippleButton } from "@/components/magicui/ripple-button";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { TextAnimate } from "@/components/magicui/text-animate";
import { site } from "@/lib/site";

export function Cta() {
	return (
		<section className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto max-w-3xl px-5 text-center sm:px-6">
				<BlurFade>
					<TextAnimate
						as="h2"
						animation="blurInUp"
						by="word"
						once
						className="font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl"
					>
						Ship on your own hardware.
					</TextAnimate>
					<p className="mx-auto mt-4 max-w-xl text-neutral-400">
						Install Nixploy in minutes. Own the panel, the Traefik edge, and every deploy after
						that.
					</p>
					<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Link href="/install">
							<ShimmerButton className="h-11 gap-2 px-6 text-sm font-medium">
								Install now <ArrowRight className="size-4" />
							</ShimmerButton>
						</Link>
						<RippleButton
							className="h-11 px-5 text-sm font-medium"
							rippleColor="#ffffff"
							onClick={() => window.open(site.github, "_blank", "noopener,noreferrer")}
						>
							Star on GitHub
						</RippleButton>
					</div>
					<div className="mx-auto mt-8 max-w-2xl">
						<InstallCommand className="w-full" />
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
