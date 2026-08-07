"use client";

import { Database, GitBranch, Globe, Server, Terminal } from "lucide-react";
import { forwardRef, useRef } from "react";

import { LogoMark } from "@/components/logo";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { BlurFade } from "@/components/magicui/blur-fade";
import { TextAnimate } from "@/components/magicui/text-animate";
import { cn } from "@/lib/utils";

const Circle = forwardRef<HTMLDivElement, { className?: string; children?: React.ReactNode }>(
	({ className, children }, ref) => {
		return (
			<div
				ref={ref}
				className={cn(
					"z-10 flex size-12 items-center justify-center rounded-full border border-white/15 bg-black text-white shadow-[0_0_20px_-8px_rgba(255,255,255,0.35)]",
					className,
				)}
			>
				{children}
			</div>
		);
	},
);
Circle.displayName = "Circle";

export function DeployBeam() {
	const containerRef = useRef<HTMLDivElement>(null);
	const gitRef = useRef<HTMLDivElement>(null);
	const dbRef = useRef<HTMLDivElement>(null);
	const cliRef = useRef<HTMLDivElement>(null);
	const centerRef = useRef<HTMLDivElement>(null);
	const serverRef = useRef<HTMLDivElement>(null);
	const edgeRef = useRef<HTMLDivElement>(null);

	return (
		<section className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<div className="mx-auto max-w-2xl text-center">
					<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
						Deploy path
					</p>
					<TextAnimate
						as="h2"
						animation="blurInUp"
						by="word"
						once
						className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl"
					>
						From source to edge in one flow
					</TextAnimate>
					<p className="mt-4 text-neutral-400">
						Git, databases, and the CLI feed Nixploy — Swarm runs it, Traefik exposes it.
					</p>
				</div>

				<BlurFade delay={0.1} className="mt-14">
					<div
						ref={containerRef}
						className="relative mx-auto flex h-[360px] w-full max-w-3xl items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-white/[0.02] p-8"
					>
						<div className="flex size-full max-w-lg flex-col items-stretch justify-between gap-8">
							<div className="flex flex-row items-center justify-between">
								<Circle ref={gitRef}>
									<GitBranch className="size-5" />
								</Circle>
								<Circle ref={dbRef}>
									<Database className="size-5" />
								</Circle>
								<Circle ref={cliRef}>
									<Terminal className="size-5" />
								</Circle>
							</div>
							<div className="flex flex-row items-center justify-center">
								<Circle ref={centerRef} className="size-16">
									<LogoMark className="size-9" />
								</Circle>
							</div>
							<div className="flex flex-row items-center justify-between px-8">
								<Circle ref={serverRef}>
									<Server className="size-5" />
								</Circle>
								<Circle ref={edgeRef}>
									<Globe className="size-5" />
								</Circle>
							</div>
						</div>

						<AnimatedBeam
							containerRef={containerRef}
							fromRef={gitRef}
							toRef={centerRef}
							curvature={-40}
							pathColor="#404040"
							gradientStartColor="#ffffff"
							gradientStopColor="#a3a3a3"
						/>
						<AnimatedBeam
							containerRef={containerRef}
							fromRef={dbRef}
							toRef={centerRef}
							pathColor="#404040"
							gradientStartColor="#ffffff"
							gradientStopColor="#a3a3a3"
						/>
						<AnimatedBeam
							containerRef={containerRef}
							fromRef={cliRef}
							toRef={centerRef}
							curvature={40}
							pathColor="#404040"
							gradientStartColor="#ffffff"
							gradientStopColor="#a3a3a3"
						/>
						<AnimatedBeam
							containerRef={containerRef}
							fromRef={centerRef}
							toRef={serverRef}
							curvature={40}
							pathColor="#404040"
							gradientStartColor="#ffffff"
							gradientStopColor="#a3a3a3"
							delay={0.5}
						/>
						<AnimatedBeam
							containerRef={containerRef}
							fromRef={centerRef}
							toRef={edgeRef}
							curvature={-40}
							pathColor="#404040"
							gradientStartColor="#ffffff"
							gradientStopColor="#a3a3a3"
							delay={0.5}
						/>
					</div>
				</BlurFade>
			</div>
		</section>
	);
}
