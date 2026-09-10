"use client";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Button, Container, WindowFrame } from "@/components/ui";

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-32 pb-10 sm:pt-40 sm:pb-16">
			<div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[70vh]" aria-hidden />
			<Container className="relative">
				<div className="mx-auto max-w-3xl text-center">
					<BlurFade delay={0.05}>
						<h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance text-foreground sm:text-6xl">
							Deploy anything.
							<br />
							<span className="text-gradient">Own everything.</span>
						</h1>
					</BlurFade>
					<BlurFade delay={0.15}>
						<p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
							Nixploy turns a Linux server into your own platform: Git push deploys, databases with
							backups, TLS domains, monitoring and a full API — installed with one command, nothing
							to pay per app.
						</p>
					</BlurFade>
					<BlurFade delay={0.25}>
						<div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
							<Button href="/docs/install" arrow>
								Install Nixploy
							</Button>
							<Button href="/docs" variant="secondary">
								Read the docs
							</Button>
						</div>
					</BlurFade>
				</div>

				<BlurFade delay={0.35} className="mx-auto mt-16 max-w-5xl sm:mt-20">
					<WindowFrame
						src="/screenshots/02-dashboard.png"
						alt="Nixploy dashboard with projects, services and recent deployments"
						priority
					/>
				</BlurFade>
			</Container>
		</section>
	);
}
