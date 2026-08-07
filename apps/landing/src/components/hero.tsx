"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { InstallCommand } from "@/components/install-command";
import { LogoMark } from "@/components/logo";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { Particles } from "@/components/magicui/particles";
import { RippleButton } from "@/components/magicui/ripple-button";
import { Safari } from "@/components/magicui/safari";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { TextAnimate } from "@/components/magicui/text-animate";
import { WordRotate } from "@/components/magicui/word-rotate";

export function Hero() {
	const router = useRouter();

	return (
		<section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-24">
			<Particles className="absolute inset-0" quantity={90} ease={80} color="#ffffff" refresh />

			<div className="relative mx-auto max-w-6xl px-5 sm:px-6">
				<div className="mx-auto max-w-3xl text-center">
					<BlurFade delay={0.05}>
						<div className="mb-7 flex flex-col items-center gap-4">
							<LogoMark className="size-14 rounded-xl sm:size-16" />
							<div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1">
								<AnimatedShinyText className="mx-0 text-xs font-medium tracking-wide text-neutral-300">
									Self-hosted PaaS · open source
								</AnimatedShinyText>
							</div>
						</div>
					</BlurFade>

					<TextAnimate
						as="h1"
						by="character"
						animation="blurInUp"
						startOnView={false}
						className="font-display text-balance text-4xl font-semibold tracking-tight text-white sm:text-6xl lg:text-7xl"
					>
						Nixploy
					</TextAnimate>

					<div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
						<span>Ship</span>
						<WordRotate
							className="text-neutral-400"
							words={["apps", "databases", "compose", "anything"]}
						/>
						<span>on your metal.</span>
					</div>

					<TextAnimate
						as="p"
						by="word"
						animation="fadeIn"
						delay={0.2}
						startOnView={false}
						className="mx-auto mt-5 max-w-2xl text-balance text-lg leading-relaxed text-neutral-400 sm:text-xl"
					>
						Deploy apps, databases, and compose stacks on infrastructure you control — with Git
						deploys, Traefik TLS, and a first-class CLI.
					</TextAnimate>

					<BlurFade delay={0.28}>
						<div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
							<Link href="/install">
								<ShimmerButton className="h-11 gap-2 px-6 text-sm font-medium">
									Get started <ArrowRight className="size-4" />
								</ShimmerButton>
							</Link>
							<RippleButton
								className="h-11 px-5 text-sm font-medium"
								rippleColor="#ffffff"
								onClick={() => router.push("/docs")}
							>
								Documentation
							</RippleButton>
						</div>
					</BlurFade>

					<BlurFade delay={0.34}>
						<div className="mx-auto mt-8 max-w-2xl">
							<InstallCommand className="w-full" />
						</div>
					</BlurFade>
				</div>

				<BlurFade delay={0.4} className="relative mx-auto mt-16 max-w-5xl">
					<div className="relative">
						<Safari imageSrc="/screenshots/02-dashboard.png" url="panel.nixploy.local" />
						<BorderBeam size={120} duration={10} colorFrom="#ffffff" colorTo="#525252" />
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
