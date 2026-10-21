import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { heroBadge, heroLead, heroTitle } from "@/lib/landing-data";

/** Product-dominant fold: a narrow editorial introduction gives the canvas to the real panel. */
export function Hero() {
	return (
		<section className="container-page pt-32 pb-10 lg:pt-36 lg:pb-12">
			<div className="mb-8 flex flex-wrap items-center gap-4 font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
				<span>Self-hosted. Open source. Yours.</span>
				<span className="hidden h-px w-8 bg-border sm:block" />
				<a
					href={heroBadge.href}
					target="_blank"
					rel="noreferrer"
					className="inline-flex min-h-11 items-center gap-2 underline-offset-4 hover:underline"
				>
					{heroBadge.version}
					<ArrowUpRight className="size-3" />
				</a>
			</div>
			<div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
				<h1 className="max-w-3xl text-[clamp(2.75rem,5.5vw,5.5rem)] leading-[0.98] font-semibold tracking-[-0.065em]">
					{heroTitle[0]}
					<br />
					<span className="text-muted-foreground">{heroTitle[1]}</span>
				</h1>
				<div className="max-w-sm space-y-6 lg:pb-1">
					<p className="text-base leading-relaxed text-muted-foreground">{heroLead}</p>
					<div className="flex flex-wrap items-center gap-3">
						<Button asChild size="lg" className="h-12 rounded-md px-5">
							<Link href="/docs/install">
								Install Nixploy
								<ArrowRight className="size-4" />
							</Link>
						</Button>
						<Link
							href="/docs"
							className="inline-flex min-h-12 items-center gap-2 px-2 text-sm font-medium underline underline-offset-4"
						>
							Read the docs
						</Link>
					</div>
				</div>
			</div>
		</section>
	);
}
