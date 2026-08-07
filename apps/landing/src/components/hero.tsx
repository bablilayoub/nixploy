"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";

import { LogoMark } from "@/components/logo";
import { site } from "@/lib/site";

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
			<div className="relative mx-auto max-w-6xl px-5 sm:px-6">
				<motion.div
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
					className="mx-auto max-w-3xl text-center"
				>
					<div className="mb-8 flex flex-col items-center gap-4">
						<LogoMark className="size-14 rounded-xl sm:size-16" />
						<p className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
							Nixploy
						</p>
					</div>

					<h1 className="font-display text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
						Your servers. <span className="text-muted">Your PaaS.</span>
					</h1>

					<p className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed text-muted">
						Deploy apps, databases, and compose stacks on infrastructure you control — with Git
						deploys, Traefik TLS, and a first-class CLI.
					</p>

					<div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Link
							href="/install"
							className="inline-flex h-11 items-center gap-2 rounded-md bg-amber px-5 text-sm font-medium text-background transition-colors hover:bg-amber-soft"
						>
							Install <ArrowRight className="size-4" />
						</Link>
						<Link
							href="/docs"
							className="inline-flex h-11 items-center rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
						>
							Docs
						</Link>
					</div>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
					className="relative mx-auto mt-16 max-w-5xl"
				>
					<div className="overflow-hidden rounded-lg border border-border bg-surface shadow-[0_40px_80px_-40px_rgba(232,163,23,0.25)]">
						<div className="flex items-center gap-2 border-b border-border px-4 py-3">
							<span className="size-2 rounded-full bg-border" />
							<span className="size-2 rounded-full bg-border" />
							<span className="size-2 rounded-full bg-border" />
							<span className="ml-3 font-mono text-[11px] text-muted">
								{site.url.replace("https://", "panel.")}
							</span>
						</div>
						<Image
							src="/screenshots/02-dashboard.png"
							alt="Nixploy dashboard"
							width={1600}
							height={1000}
							priority
							className="h-auto w-full"
						/>
					</div>
				</motion.div>
			</div>
		</section>
	);
}
