import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { Button } from "@/components/ui/button";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Spotlight } from "@/components/ui/spotlight-new";
import { AnimatedSpan, Terminal, TypingAnimation } from "@/components/ui/terminal";
import { heroBadge, heroInstall, heroLead, heroTitle } from "@/lib/landing-data";

/*
 * The fold. Everything visual here is a registry component — the light is
 * @aceternity/spotlight-new, the badge is @magicui/animated-shiny-text, the
 * primary action is @magicui/shimmer-button and the transcript is
 * @magicui/terminal. The layout and the words are the only things written
 * here.
 *
 * The transcript is what install.sh actually prints; the step names are its
 * eleven `step` calls and the ticks are its `ok` lines.
 */
export function Hero() {
	const [claim, promise] = heroTitle;

	return (
		<section className="relative overflow-hidden pt-28 pb-12 md:pt-36 lg:pb-16">
			<Spotlight />

			<div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-6 lg:grid-cols-2 lg:gap-16">
				<div>
					<Link
						href={heroBadge.href}
						target="_blank"
						rel="noreferrer"
						className="group inline-flex items-center rounded-full border border-white/10 bg-white/5 px-1 py-1 text-sm backdrop-blur transition-colors hover:border-white/20"
					>
						<span className="mr-2 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-xs text-primary">
							{heroBadge.version}
						</span>
						<AnimatedShinyText className="inline-flex items-center justify-center px-1 py-0.5">
							<span>{heroBadge.text}</span>
							<ArrowRight className="ml-1 size-3 transition-transform duration-300 group-hover:translate-x-0.5" />
						</AnimatedShinyText>
					</Link>

					<h1 className="mt-7 text-5xl leading-[1.05] font-semibold tracking-tight text-balance md:text-6xl lg:text-7xl">
						<span className="block">{claim}</span>
						<span className="block bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent">
							{promise}
						</span>
					</h1>

					<p className="mt-6 max-w-xl text-lg text-muted-foreground">{heroLead}</p>

					<div className="mt-9 flex flex-wrap items-center gap-3">
						<ShimmerButton className="shadow-2xl" background="oklch(0.22 0.01 275)">
							<Link
								href="/docs/install"
								className="flex items-center gap-2 text-base font-medium whitespace-nowrap text-white"
							>
								Install Nixploy
								<ArrowRight className="size-4" />
							</Link>
						</ShimmerButton>
						<Button asChild variant="outline" size="lg" className="h-12 rounded-xl px-6">
							<Link href="/docs">Read the docs</Link>
						</Button>
					</div>
				</div>

				<Terminal className="h-auto max-h-none w-full max-w-none bg-card/60 backdrop-blur">
					<TypingAnimation duration={28}>{`> ${heroInstall.lines[0].text}`}</TypingAnimation>
					{heroInstall.lines.slice(1).map((line, index) => (
						<AnimatedSpan
							key={line.text}
							delay={1400 + index * 550}
							className={line.tone === "ok" ? "text-emerald-400" : "text-muted-foreground"}
						>
							{line.text}
						</AnimatedSpan>
					))}
					<AnimatedSpan delay={1400 + heroInstall.lines.length * 550} className="text-foreground">
						Setup token printed · panel ready
					</AnimatedSpan>
				</Terminal>
			</div>
		</section>
	);
}
