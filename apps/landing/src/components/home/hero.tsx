import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FoldBackdrop } from "@/components/fold-backdrop";
import { InstallCommand } from "@/components/install-command";
import { Container, Pill, TerminalFrame } from "@/components/ui";
import { heroBadge, heroLead, heroTitle, screens } from "@/lib/landing-data";

/*
 * The fold: the latest release as a badge, three centred lines with the
 * middle one lit, one sentence, the two actions, the one-liner, and the
 * panel in a window on graph paper. Nothing here animates in — this is the
 * first paint, and a fold that fades in is a fold that arrives late.
 */
export function Hero() {
	const [first, second, third] = heroTitle;
	const cover = screens[0];

	return (
		<section className="relative overflow-hidden">
			{/* Graph paper and the glow behind the title — shared with every other
			    page's header, at the fold's volume (components/fold-backdrop.tsx). */}
			<FoldBackdrop variant="hero" />

			<Container className="pt-20 lg:pt-28">
				<div className="flex flex-col items-center text-center">
					<Link
						href={heroBadge.href}
						target="_blank"
						rel="noreferrer"
						className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface/70 pr-4 pl-1 text-small text-muted transition-colors hover:border-border-strong hover:text-foreground"
					>
						<span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-micro text-foreground">
							{heroBadge.version}
						</span>
						{heroBadge.text}
						<ArrowRight className="size-3.5" aria-hidden />
					</Link>

					<h1 className="mt-8 max-w-[16ch] text-[2.5rem] leading-[1.1] font-medium tracking-[-0.02em] text-balance sm:text-headline lg:text-[4.5rem] lg:leading-[1.05]">
						<span className="block text-muted">{first}</span>
						<span className="block text-foreground">{second}</span>
						<span className="block text-muted">{third}</span>
					</h1>

					<p className="mt-6 max-w-[44rem] text-lead text-balance text-muted">{heroLead}</p>

					<div className="mt-8 flex flex-wrap items-center justify-center gap-2">
						<Pill href="/docs/install" size="lg" arrow>
							Install Nixploy
						</Pill>
						<Pill href="/docs" variant="ghost" size="lg">
							Read the docs
						</Pill>
					</div>

					<InstallCommand className="mt-4 w-full max-w-[36rem]" />
				</div>

				{/* A capture of the running panel, not an illustration: the proof the product exists. */}
				<div className="mx-auto mt-16 max-w-[1120px] rounded-2xl shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] lg:mt-20">
					<TerminalFrame title="panel.acme.dev" tag="overview" bodyClassName="p-0">
						<Image
							src={cover.src}
							alt={cover.alt}
							width={3200}
							height={2000}
							priority
							sizes="(min-width:1200px) 1120px, 100vw"
							className="h-auto w-full"
						/>
					</TerminalFrame>
				</div>
			</Container>
		</section>
	);
}
