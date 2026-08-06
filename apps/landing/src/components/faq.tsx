"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { site } from "@/lib/site";

const faqs = [
	{
		q: "What do I need to run Nixploy?",
		a: "Any Linux server with Docker — a small VPS, bare metal, or a homelab box. One install command sets up the dashboard, deploy engine, and Traefik.",
	},
	{
		q: "Where does my data live?",
		a: "On your infrastructure. Databases, volumes, secrets, and logs stay on your servers. Nothing is required to phone home.",
	},
	{
		q: "Can I deploy from a private Git repo?",
		a: "Yes. Connect GitHub, GitLab, Bitbucket, or Gitea — or use a generic git URL with an SSH key.",
	},
	{
		q: "Does it include monitoring and alerts?",
		a: "Live metrics, history, per-service alert rules, HTTP uptime probes, and an incident timeline.",
	},
	{
		q: "Can I manage multiple servers?",
		a: "Add remote servers over SSH and deploy from one dashboard — including multi-node Docker Swarm.",
	},
	{
		q: "Can I migrate from Coolify or Dokploy?",
		a: "Yes — recreate services on Nixploy and flip DNS when ready. See Docs for Coolify and Dokploy migration guides (no automatic DB import).",
	},
	{
		q: "Is it free?",
		a: "The self-hosted product is free and open source. See Pricing and the GitHub license for details.",
	},
];

function Item({ q, a }: { q: string; a: string }) {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const buttonId = `${panelId}-button`;

	return (
		<div className="border-b border-white/10">
			<button
				type="button"
				id={buttonId}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center justify-between gap-4 py-5 text-left"
			>
				<span className="text-[15px] font-medium text-white">{q}</span>
				<Plus
					aria-hidden
					className={`size-4 shrink-0 text-neutral-500 transition-transform duration-300 ${
						open ? "rotate-45" : ""
					}`}
				/>
			</button>
			<section
				id={panelId}
				aria-labelledby={buttonId}
				hidden={!open}
				className={open ? "pb-5" : undefined}
			>
				{open && <p className="text-sm leading-relaxed text-neutral-400">{a}</p>}
			</section>
		</div>
	);
}

export function Faq() {
	return (
		<section id="faq" className="border-t border-white/10 py-24 sm:py-28">
			<div className="mx-auto max-w-3xl px-5 sm:px-6">
				<BlurFade inView>
					<div className="mb-10 text-center">
						<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
							Questions
						</h2>
						<p className="mt-3 text-neutral-500">
							More on{" "}
							<Link href="/about" className="text-neutral-300 underline underline-offset-4">
								About
							</Link>{" "}
							· issues on{" "}
							<a
								href={site.github}
								target="_blank"
								rel="noreferrer"
								className="text-neutral-300 underline underline-offset-4"
							>
								GitHub
							</a>
							.
						</p>
					</div>
				</BlurFade>
				<div className="border-t border-white/10">
					{faqs.map((f, i) => (
						<BlurFade key={f.q} delay={0.03 * i} inView>
							<Item q={f.q} a={f.a} />
						</BlurFade>
					))}
				</div>
			</div>
		</section>
	);
}
