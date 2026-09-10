"use client";

import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { TextAnimate } from "@/components/magicui/text-animate";
import { Button, Container } from "@/components/ui";
import { site } from "@/lib/site";

export function Cta() {
	return (
		<section className="relative overflow-hidden border-t border-border py-24 sm:py-32">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_100%,rgba(242,181,61,0.16),transparent_70%)]"
			/>
			<Container className="relative max-w-3xl text-center">
				<BlurFade inView>
					<p className="eyebrow">Your next deploy</p>
					<TextAnimate
						as="h2"
						animation="blurInUp"
						by="word"
						once
						className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-5xl"
					>
						Could be on your own hardware tonight.
					</TextAnimate>
					<p className="mx-auto mt-4 max-w-xl text-muted">
						Bring a Linux box. One curl later you have the panel, the Traefik edge, Postgres, and a
						platform you actually own.
					</p>
					<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Button href="/docs/install" arrow>
							Read the install guide
						</Button>
						<Button href={site.github} variant="secondary" external>
							Star on GitHub
						</Button>
					</div>
					<div className="mx-auto mt-8 max-w-2xl">
						<InstallCommand className="w-full" />
					</div>
				</BlurFade>
			</Container>
		</section>
	);
}
