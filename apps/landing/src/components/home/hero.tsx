import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { FoldBackdrop } from "@/components/fold-backdrop";
import { InstallCommand } from "@/components/install-command";
import { Container, Pill, TerminalFrame } from "@/components/ui";
import { heroBadge, heroInstall, heroLead, heroTitle } from "@/lib/landing-data";
import { cn } from "@/lib/utils";

/*
 * The fold, split rather than centred.
 *
 * A centred column of badge, title, sentence, two buttons is the shape every
 * generated page has, and it makes the reader scroll before seeing anything
 * the product does. Here the left half is the claim and the right half is the
 * install actually running — the first thing on the page is the thing the
 * page is asking you to do. The panel capture follows immediately, in the
 * window that is also the screens section, so the fold is claim, proof,
 * product in one screen.
 *
 * Nothing here animates in: this is the first paint, and a fold that fades in
 * is a fold that arrives late.
 */

const toneClass = {
	in: "text-foreground",
	step: "text-muted",
	ok: "text-success",
} as const;

function InstallTranscript() {
	return (
		<TerminalFrame
			title={heroInstall.host}
			tag="install"
			className="shadow-[0_24px_80px_-40px_#000]"
		>
			<pre className="overflow-x-auto font-mono text-micro leading-[2.1] sm:text-small">
				{heroInstall.lines.map((line) => (
					<div key={line.text} className={cn("flex gap-2", toneClass[line.tone])}>
						{line.tone === "in" ? <span className="text-muted-2">$</span> : null}
						<span className="min-w-0">{line.text}</span>
					</div>
				))}
			</pre>
		</TerminalFrame>
	);
}

export function Hero() {
	const [claim, promise] = heroTitle;

	return (
		<section className="relative overflow-hidden">
			{/* Graph paper and the glow behind the title — shared with every other
			    page's header, at the fold's volume (components/fold-backdrop.tsx). */}
			<FoldBackdrop variant="hero" />

			<Container className="pt-16 lg:pt-24">
				<div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-12">
					<div className="min-w-0 lg:col-span-6">
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

						<h1 className="mt-7 text-[2.75rem] leading-[1.05] font-medium tracking-[-0.03em] text-balance sm:text-headline lg:text-[4rem]">
							<span className="block text-foreground">{claim}</span>
							<span className="block text-muted">{promise}</span>
						</h1>

						<p className="mt-6 max-w-[34rem] text-lead text-muted">{heroLead}</p>

						<div className="mt-8 flex flex-wrap items-center gap-2">
							<Pill href="/docs/install" size="lg" arrow>
								Install Nixploy
							</Pill>
							<Pill href="/docs" variant="ghost" size="lg">
								Read the docs
							</Pill>
						</div>

						<InstallCommand className="mt-4 max-w-[34rem]" />
					</div>

					{/* The install, running. Pushed a little past the column on wide
					    screens so the fold does not read as two equal boxes. */}
					{/* `min-w-0`: a grid item defaults to min-content width, so the wide
					    transcript would push the whole fold past the viewport instead of
					    scrolling inside its own frame. */}
					<div className="min-w-0 lg:col-span-6 lg:pl-4">
						<InstallTranscript />
					</div>
				</div>
			</Container>
		</section>
	);
}
