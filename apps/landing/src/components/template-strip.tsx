"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { BlurFade } from "@/components/magicui/blur-fade";

const categories = [
	{ name: "AI", count: 4 },
	{ name: "Analytics", count: 4 },
	{ name: "Apps", count: 7 },
	{ name: "CMS", count: 6 },
	{ name: "Communication", count: 2 },
	{ name: "Databases", count: 6 },
	{ name: "Finance", count: 3 },
	{ name: "Knowledge", count: 10 },
	{ name: "Media", count: 5 },
	{ name: "Monitoring", count: 7 },
	{ name: "Notifications", count: 4 },
	{ name: "Productivity", count: 10 },
	{ name: "Security", count: 6 },
	{ name: "Storage", count: 3 },
	{ name: "Tools", count: 9 },
] as const;

const wellKnown = [
	"Supabase",
	"Plausible",
	"Ghost",
	"Uptime Kuma",
	"Ollama",
	"Metabase",
	"n8n",
	"MinIO",
	"Vaultwarden",
	"Umami",
];

export function TemplateStrip() {
	return (
		<section className="border-t border-white/8 py-20 sm:py-28">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<BlurFade>
					<div className="max-w-2xl">
						<p className="font-mono text-xs tracking-[0.18em] text-neutral-500 uppercase">
							Template catalog
						</p>
						<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
							86 one-click deploys, no lock-in after.
						</h2>
						<p className="mt-4 text-neutral-400">
							{wellKnown.slice(0, 6).join(", ")} and dozens more. Every template deploys as a plain
							compose service you can edit, version, and back up like anything else you run.
						</p>
					</div>
				</BlurFade>

				<BlurFade delay={0.1}>
					<ul className="mt-10 flex flex-wrap gap-2">
						{categories.map((category) => (
							<li
								key={category.name}
								className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm text-neutral-300"
							>
								{category.name}
								<span className="font-mono text-xs text-neutral-500">{category.count}</span>
							</li>
						))}
					</ul>
				</BlurFade>

				<BlurFade delay={0.16}>
					<p className="mt-8 text-sm text-neutral-500">
						<span className="text-neutral-300">{wellKnown.join(" · ")}</span>
					</p>
					<Link
						href="/features"
						className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-white underline-offset-4 hover:underline"
					>
						Browse the catalog <ArrowRight className="size-4" />
					</Link>
				</BlurFade>
			</div>
		</section>
	);
}
