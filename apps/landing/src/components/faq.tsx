"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { cn } from "@/lib/utils";

const faqs = [
	{
		q: "Is Nixploy really free?",
		a: "Yes. Apache-2.0, no hosted tier, no license key. The only thing you pay for is the server it runs on.",
	},
	{
		q: "What do I need to install?",
		a: "A Linux host with Docker and an active Swarm. One curl installs the panel, Traefik, and the config layout — you're deploying within minutes.",
	},
	{
		q: "Can I run more than one server?",
		a: "Yes. Add remote servers over SSH from Settings → Servers; they join the same Swarm and report metrics back to the same monitoring view.",
	},
	{
		q: "Can I use my own domains and TLS?",
		a: "Yes. Point DNS at your server, attach the domain to a service, and Traefik issues the Let's Encrypt certificate. Redirects and basic-auth rules are built in.",
	},
	{
		q: "How do I deploy from Git?",
		a: "Connect GitHub, GitLab, Bitbucket, or Gitea — or paste any Git URL. Pick a branch and a builder (Nixpacks, buildpacks, Dockerfile), and every push triggers a deploy.",
	},
	{
		q: "Is there an API?",
		a: "The whole panel is an API: REST with OpenAPI docs on your own instance, the @nixploy/cli for terminals, and an MCP server so AI assistants can operate it too.",
	},
] as const;

export function Faq() {
	const [open, setOpen] = useState<number | null>(0);

	return (
		<section id="faq" className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto max-w-3xl px-5 sm:px-6">
				<BlurFade>
					<div>
						<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">FAQ</p>
						<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
							Frequently asked questions
						</h2>
					</div>
				</BlurFade>

				<ul className="mt-12 divide-y divide-white/8 border-y border-white/8">
					{faqs.map((item, i) => {
						const isOpen = open === i;
						return (
							<li key={item.q}>
								<button
									type="button"
									className="flex w-full items-center justify-between gap-4 py-5 text-left"
									onClick={() => setOpen(isOpen ? null : i)}
									aria-expanded={isOpen}
								>
									<span className="font-display text-base font-medium text-white sm:text-lg">
										{item.q}
									</span>
									<ChevronDown
										className={cn(
											"size-5 shrink-0 text-neutral-500 transition-transform",
											isOpen && "rotate-180",
										)}
									/>
								</button>
								<div
									className={cn(
										"grid transition-[grid-template-rows] duration-300",
										isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
									)}
								>
									<div className="overflow-hidden">
										<p className="pb-5 text-sm leading-relaxed text-neutral-400">{item.a}</p>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}
