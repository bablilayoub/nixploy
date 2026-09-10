"use client";

import { Cloud, Container as ContainerIcon, GitBranch, Globe, Hammer } from "lucide-react";
import { type RefObject, useRef } from "react";

import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Container, SectionHeading } from "@/components/ui";
import { pipelineSteps } from "@/lib/landing-data";

function Node({
	ref,
	icon: Icon,
	label,
	sub,
	accent,
}: {
	ref: RefObject<HTMLDivElement | null>;
	icon: typeof GitBranch;
	label: string;
	sub: string;
	accent?: boolean;
}) {
	return (
		<div ref={ref} className="relative z-10 flex flex-col items-center gap-2 text-center">
			<div
				className={
					accent
						? "grid size-14 place-items-center rounded-2xl border border-accent/50 bg-accent-soft text-accent shadow-[0_0_40px_-10px_rgba(242,181,61,0.6)]"
						: "grid size-14 place-items-center rounded-2xl border border-border bg-surface-2 text-foreground"
				}
			>
				<Icon className="size-6" strokeWidth={1.6} />
			</div>
			<p className="font-display text-sm font-semibold text-foreground">{label}</p>
			<p className="font-mono text-[11px] whitespace-nowrap text-muted-2">{sub}</p>
		</div>
	);
}

function Diagram() {
	const container = useRef<HTMLDivElement>(null);
	const git = useRef<HTMLDivElement>(null);
	const build = useRef<HTMLDivElement>(null);
	const swarm = useRef<HTMLDivElement>(null);
	const traefik = useRef<HTMLDivElement>(null);
	const live = useRef<HTMLDivElement>(null);

	const beam = {
		containerRef: container,
		pathColor: "#343a46",
		pathOpacity: 0.7,
		gradientStartColor: "#f2b53d",
		gradientStopColor: "#79cdff",
		duration: 3.2,
	};

	return (
		<div ref={container} className="card relative overflow-hidden p-6 sm:p-10">
			<div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
			<div className="relative grid grid-cols-5 items-start gap-2">
				<Node ref={git} icon={GitBranch} label="git push" sub="webhook" />
				<Node ref={build} icon={Hammer} label="build" sub="nixpacks · docker" />
				<Node ref={swarm} icon={ContainerIcon} label="rollout" sub="zero-downtime" accent />
				<Node ref={traefik} icon={Globe} label="route" sub="traefik · tls" />
				<Node ref={live} icon={Cloud} label="live" sub="logs · metrics" />
			</div>
			<AnimatedBeam {...beam} fromRef={git} toRef={build} startYOffset={-18} endYOffset={-18} />
			<AnimatedBeam
				{...beam}
				fromRef={build}
				toRef={swarm}
				delay={0.8}
				startYOffset={-18}
				endYOffset={-18}
			/>
			<AnimatedBeam
				{...beam}
				fromRef={swarm}
				toRef={traefik}
				delay={1.6}
				startYOffset={-18}
				endYOffset={-18}
			/>
			<AnimatedBeam
				{...beam}
				fromRef={traefik}
				toRef={live}
				delay={2.4}
				startYOffset={-18}
				endYOffset={-18}
			/>
		</div>
	);
}

export function Pipeline() {
	return (
		<section id="how-it-works" className="py-20 sm:py-28">
			<Container>
				<div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
					<BlurFade inView>
						<SectionHeading
							eyebrow="How a deploy goes out"
							title="git push is the whole workflow."
							lede="Every step below is something you can watch, cancel, or roll back from the panel — and every one of them is also an API call."
						/>
						<ol className="mt-10 space-y-7">
							{pipelineSteps.map((step) => (
								<li key={step.n} className="flex gap-4">
									<span className="mt-0.5 font-mono text-xs text-accent">{step.n}</span>
									<div>
										<h3 className="font-display text-base font-semibold text-foreground">
											{step.title}
										</h3>
										<p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">
											{step.body}
										</p>
									</div>
								</li>
							))}
						</ol>
					</BlurFade>
					<BlurFade inView delay={0.1} className="lg:pt-6">
						<Diagram />
						<div className="mt-4 grid grid-cols-3 gap-3 text-center">
							{[
								["Builders", "Nixpacks · Railpack · Dockerfile · Buildpacks · Static"],
								["Sources", "GitHub · GitLab · Bitbucket · Gitea · image · zip"],
								["Rollouts", "Rolling update · health checks · instant rollback"],
							].map(([title, body]) => (
								<div key={title} className="card px-3 py-3">
									<p className="font-display text-xs font-semibold text-foreground">{title}</p>
									<p className="mt-1 text-[11px] leading-relaxed text-muted-2">{body}</p>
								</div>
							))}
						</div>
					</BlurFade>
				</div>
			</Container>
		</section>
	);
}
