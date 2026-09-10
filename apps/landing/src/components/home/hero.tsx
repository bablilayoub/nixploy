"use client";

import { GithubIcon } from "@/components/icons";

import { InstallCommand } from "@/components/install-command";
import { BlurFade } from "@/components/magicui/blur-fade";
import { TypingTerminal } from "@/components/magicui/typing-terminal";
import { WordRotate } from "@/components/magicui/word-rotate";
import { Button, Container, Pill } from "@/components/ui";
import { heroLog, heroWords } from "@/lib/landing-data";
import { site } from "@/lib/site";

const statusChips = [
	{ label: "api-42", state: "running", replicas: "3/3" },
	{ label: "postgres-17", state: "running", replicas: "1/1" },
	{ label: "pr-118-web", state: "preview", replicas: "1/1" },
];

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-28 pb-14 sm:pt-36 sm:pb-20">
			<Container>
				<div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
					<div className="max-w-2xl">
						<BlurFade delay={0.05}>
							<a
								href={site.github}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-foreground"
							>
								<span className="size-1.5 rounded-full bg-success" />
								Open source · Apache-2.0 · v0.1
								<GithubIcon className="size-3.5" />
							</a>
						</BlurFade>

						<BlurFade delay={0.12}>
							<h1 className="mt-6 font-display text-[2.5rem] leading-[1.04] font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.6rem]">
								Deploy <WordRotate words={heroWords} className="text-gradient-gold" />
								<br />
								to servers you own.
							</h1>
						</BlurFade>

						<BlurFade delay={0.2}>
							<p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
								Nixploy turns any Linux box into a platform: Git push deploys, databases with real
								backups, Traefik TLS, live logs and metrics, a full REST/CLI/MCP surface — one
								command to install, nothing to pay per app.
							</p>
						</BlurFade>

						<BlurFade delay={0.28}>
							<div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
								<Button href="/docs/install" arrow>
									Install in 2 minutes
								</Button>
								<Button href="/features" variant="secondary">
									See everything it does
								</Button>
							</div>
							<InstallCommand className="mt-4 w-full max-w-xl" />
						</BlurFade>

						<BlurFade delay={0.36}>
							<div className="mt-6 flex flex-wrap gap-2">
								<Pill>Docker Swarm</Pill>
								<Pill>Traefik v3 + Let's Encrypt</Pill>
								<Pill>Postgres · MySQL · MariaDB · Mongo · Redis</Pill>
								<Pill>x86_64 · arm64</Pill>
							</div>
						</BlurFade>
					</div>

					<BlurFade delay={0.3} direction="left" className="relative">
						<div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(242,181,61,0.16),transparent_70%)] blur-2xl" />
						<div className="card overflow-hidden">
							<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
								{statusChips.map((chip) => (
									<span
										key={chip.label}
										className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-muted"
									>
										<span
											className={
												chip.state === "preview"
													? "size-1.5 rounded-full bg-cool"
													: "size-1.5 rounded-full bg-success"
											}
										/>
										{chip.label}
										<span className="text-muted-2">{chip.replicas}</span>
									</span>
								))}
								<span className="ml-auto font-mono text-[11px] text-muted-2">server-1 · swarm</span>
							</div>
							<TypingTerminal lines={heroLog} className="rounded-none border-0" />
						</div>
					</BlurFade>
				</div>
			</Container>
		</section>
	);
}
