import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Spotlight } from "@/components/ui/spotlight-new";
import { heroBadge, heroLead, heroTitle } from "@/lib/landing-data";
import { site } from "@/lib/site";

/*
 * The fold: one centred column, and then the product itself in the section
 * below it. The light is @aceternity/spotlight-new, the badge is
 * @magicui/animated-shiny-text, the primary action is
 * @magicui/shimmer-button and the one-liner is @aceternity/code-block — the
 * same block the docs use, so the command you copy here is the command the
 * install guide shows.
 */
export function Hero() {
	const [claim, promise] = heroTitle;

	return (
		<section className="relative overflow-hidden pt-20 pb-14 md:pt-28 lg:pb-20">
			{/* The registry component's default gradients are blue; the site has no
			    accent colour, so the light is plain white at the same opacities. */}
			<Spotlight
				gradientFirst="radial-gradient(68.54% 68.72% at 55.02% 31.46%, hsla(0, 0%, 100%, .08) 0, hsla(0, 0%, 100%, .02) 50%, hsla(0, 0%, 100%, 0) 80%)"
				gradientSecond="radial-gradient(50% 50% at 50% 50%, hsla(0, 0%, 100%, .06) 0, hsla(0, 0%, 100%, .02) 80%, transparent 100%)"
				gradientThird="radial-gradient(50% 50% at 50% 50%, hsla(0, 0%, 100%, .04) 0, hsla(0, 0%, 100%, .02) 80%, transparent 100%)"
			/>

			<div className="container-page relative flex flex-col items-center text-center">
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

				<h1 className="mt-8 max-w-4xl text-5xl leading-[1.05] font-semibold tracking-tight text-balance md:text-6xl lg:text-7xl">
					<span className="block">{claim}</span>
					<span className="block bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent">
						{promise}
					</span>
				</h1>

				<p className="mt-6 max-w-2xl text-lg text-balance text-muted-foreground">{heroLead}</p>

				<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
					<ShimmerButton className="shadow-2xl" background="oklch(0.22 0 0)">
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

				<div className="mt-8 w-full max-w-2xl text-left">
					<CodeBlock language="bash" filename="install.sh" code={site.install} />
				</div>
			</div>
		</section>
	);
}
