"use client";
import { ArrowUpRight, Box, GitBranch, Globe, Layers } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

const stages = [
	{
		Icon: GitBranch,
		name: "Your source",
		detail: "Git · image · Compose",
		explanation:
			"Connect a repository, use a prebuilt container image or bring a Compose stack. Keep the source of truth where you already work.",
		guide: "/docs/git",
	},
	{
		Icon: Box,
		name: "Build & package",
		detail: "Your builder. Your registry.",
		explanation:
			"Build from source or use an existing image. Choose Nixpacks, Railpack, a Dockerfile, buildpacks or a static build for your application.",
		guide: "/docs/deploy",
	},
	{
		Icon: Layers,
		name: "Deploy to Swarm",
		detail: "Services on your servers",
		explanation:
			"Run the service on your Docker Swarm. Follow the rollout, inspect runtime logs and keep a previous release available for rollback.",
		guide: "/docs/servers",
	},
	{
		Icon: Globe,
		name: "Route with Traefik",
		detail: "Your domain · automatic TLS",
		explanation:
			"Attach the hostname to its service. Traefik routes the request and manages the HTTPS certificate on the infrastructure you control.",
		guide: "/docs/domains",
	},
];
export function DeploymentPath({ compact = false }: { compact?: boolean }) {
	const [selected, setSelected] = useState(1);
	const stage = stages[selected];
	return (
		<div className={`deployment-path ${compact ? "is-compact" : ""}`}>
			<div className="path-topline">
				<span className="inline-flex items-center gap-2">
					<span className="signal-dot" />
					The deployment path
				</span>
				<span>Select a stage to explore</span>
			</div>
			<ol className="path-stages">
				{stages.map(({ Icon, name, detail }, index) => (
					<li key={name} className="path-stage" style={{ "--stage": index } as React.CSSProperties}>
						<button
							type="button"
							aria-pressed={selected === index}
							onClick={() => setSelected(index)}
							className="path-stage-button"
						>
							<span className="path-stage-icon">
								<Icon className="size-6" aria-hidden="true" />
							</span>
							<span className="path-stage-name">{name}</span>
							<span className="path-stage-detail">{detail}</span>
						</button>
					</li>
				))}
			</ol>
			<div className="path-explanation">
				<p className="font-mono text-xs text-primary">
					{String(selected + 1).padStart(2, "0")} / {stage.name}
				</p>
				<AnimatePresence initial={false} mode="wait">
					<motion.p
						key={selected}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.16 }}
						className="text-sm leading-relaxed text-muted-foreground"
						role="status"
					>
						{stage.explanation}
					</motion.p>
				</AnimatePresence>
			</div>
			<div className="path-bottomline">
				<span>Illustrated flow · your infrastructure</span>
				<Link href={stage.guide}>
					Explore {stage.name.toLowerCase()}
					<ArrowUpRight className="size-3.5" aria-hidden="true" />
				</Link>
			</div>
		</div>
	);
}
