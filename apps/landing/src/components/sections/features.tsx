import { Boxes, GitBranch, Globe, LineChart, Terminal as TerminalIcon } from "lucide-react";
import Image from "next/image";

import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";
import { Marquee } from "@/components/ui/marquee";
import { AnimatedSpan, Terminal, TypingAnimation } from "@/components/ui/terminal";
import { featuredTemplateIds } from "@/lib/landing-data";
import { findTemplate } from "@/lib/templates";

/*
 * What the product does, in @magicui/bento-grid. Each cell's artwork is
 * another registry component or a real capture: a marquee of catalogue
 * entries, the CLI in @magicui/terminal, screenshots of the panel.
 */
const marks = featuredTemplateIds
	.map(findTemplate)
	.filter((entry) => entry !== undefined)
	.slice(0, 18);

const Screenshot = ({ src, alt }: { src: string; alt: string }) => (
	<div className="absolute inset-x-6 top-6 bottom-24 overflow-hidden rounded-lg border border-white/10 opacity-70 transition-all duration-300 group-hover:opacity-90 [mask-image:linear-gradient(to_top,transparent_12%,#000_60%)]">
		<Image src={src} alt={alt} width={3200} height={2000} className="h-auto w-full" />
	</div>
);

export function Features() {
	return (
		<section id="features" className="px-6 py-20 lg:py-28">
			<div className="mx-auto max-w-7xl">
				<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
					What it does
				</p>
				<h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance lg:text-5xl">
					One box, the whole delivery loop
				</h2>

				<BentoGrid className="mt-12 auto-rows-[24rem]">
					<BentoCard
						name="Deploy a commit, not a mood"
						className="col-span-3 lg:col-span-2"
						Icon={GitBranch}
						description="GitHub, GitLab, Bitbucket and Gitea, built by nixpacks, railpack, a Dockerfile or buildpacks. Every deploy pins the image it ran."
						href="/docs/deploy"
						cta="How deploys work"
						background={
							<Screenshot
								src="/screenshots/05-deployments.png"
								alt="Deployments with image digest, status and duration"
							/>
						}
					/>
					<BentoCard
						name="146 one-click stacks"
						className="col-span-3 lg:col-span-1"
						Icon={Boxes}
						description="Reviewed compose files with pinned images and named volumes."
						href="/templates"
						cta="Browse the catalogue"
						background={
							<Marquee
								pauseOnHover
								vertical
								className="absolute inset-x-0 top-0 h-[70%] [--duration:26s] [mask-image:linear-gradient(to_top,transparent_18%,#000_70%)]"
							>
								{marks.map((template) => (
									<div
										key={template.id}
										className="mx-4 flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
									>
										<span className="truncate text-sm font-medium">{template.name}</span>
										<span className="ml-auto shrink-0 text-xs text-muted-foreground">
											{template.category}
										</span>
									</div>
								))}
							</Marquee>
						}
					/>
					<BentoCard
						name="Domains and TLS"
						className="col-span-3 lg:col-span-1"
						Icon={Globe}
						description="Traefik routes it and Let's Encrypt signs it. Link a DNS provider and the record is created for you."
						href="/docs/domains"
						cta="Domains and TLS"
						background={
							<Screenshot
								src="/screenshots/03-project.png"
								alt="A project's services with their status and domain"
							/>
						}
					/>
					<BentoCard
						name="Runtime you can read"
						className="col-span-3 lg:col-span-1"
						Icon={LineChart}
						description="CPU, memory, network and disk per container, with logs kept after the container is gone."
						href="/docs/observability"
						cta="What it records"
						background={
							<Screenshot
								src="/screenshots/06-monitoring.png"
								alt="CPU, memory, network and disk charts for a service"
							/>
						}
					/>
					<BentoCard
						name="The same surface from a terminal"
						className="col-span-3 lg:col-span-1"
						Icon={TerminalIcon}
						description="Every procedure is a REST endpoint, a CLI verb and an MCP tool."
						href="/docs/cli"
						cta="Read the CLI reference"
						background={
							<Terminal className="absolute inset-x-6 top-6 h-56 max-h-none w-auto max-w-none border-white/10 bg-transparent opacity-80 [mask-image:linear-gradient(to_top,transparent,#000_55%)]">
								<TypingAnimation duration={30}>
									{"> nixploy app deploy api --ref v1.4.0 --wait"}
								</TypingAnimation>
								<AnimatedSpan delay={1600} className="text-muted-foreground">
									building dockerfile · linux/amd64
								</AnimatedSpan>
								<AnimatedSpan delay={2200} className="text-muted-foreground">
									rollout 2/2 tasks running
								</AnimatedSpan>
								<AnimatedSpan delay={2800} className="text-emerald-400">
									done in 48s https://api.acme.dev
								</AnimatedSpan>
							</Terminal>
						}
					/>
				</BentoGrid>
			</div>
		</section>
	);
}
