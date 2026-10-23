import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { GithubIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { BlurFade } from "@/components/ui/blur-fade";
import { Button } from "@/components/ui/button";
import { Safari } from "@/components/ui/safari";
import { heroLead, heroTitle } from "@/lib/landing-data";
import { productCaptures } from "@/lib/product-captures";
import { site } from "@/lib/site";

export function Hero() {
	return (
		<section className="mono-hero border-b">
			<div className="container-page grid min-w-0 items-center gap-12 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] lg:gap-16">
				<div className="min-w-0">
					<Badge variant="outline">The open-source deployment platform</Badge>
					<h1 className="mt-6 text-[clamp(2.25rem,8vw+1rem,3rem)] leading-[1.06] font-medium tracking-[-0.045em] sm:text-6xl lg:text-[3.5rem]">
						{heroTitle[0]}
						<br />
						{heroTitle[1]}
					</h1>
					<p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
						{heroLead}
					</p>
					<div className="mt-8 flex flex-wrap gap-3">
						<Button asChild size="lg">
							<Link href="/docs/install">
								Install Nixploy
								<ArrowRight aria-hidden="true" data-icon="inline-end" />
							</Link>
						</Button>
						<Button asChild size="lg" variant="outline">
							<a href={site.github} target="_blank" rel="noreferrer">
								<GithubIcon aria-hidden="true" data-icon="inline-start" />
								View on GitHub
							</a>
						</Button>
					</div>
					<p className="mt-5 text-xs text-muted-foreground">
						Apache-2.0 · Your servers · Your data
					</p>
				</div>
				<BlurFade delay={0.1} duration={0.3} blur="0px" inView className="min-w-0">
					<figure className="min-w-0">
						<Safari
							mode="simple"
							url="Your Nixploy workspace"
							imageSrc={productCaptures.workspace.dark}
							imageAlt="Actual Nixploy project inventory in dark mode, from an example workspace"
							priority
							imageSizes="(min-width:1024px) 60vw, 100vw"
						/>
						<figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
							<span>A real example workspace.</span>
							<Link
								href="#workspace"
								className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4"
							>
								Explore the panel
								<ArrowRight aria-hidden="true" className="size-3.5" />
							</Link>
						</figcaption>
					</figure>
				</BlurFade>
			</div>
		</section>
	);
}
