"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Marquee } from "@/components/magicui/marquee";
import { Container, SectionHeading } from "@/components/ui";
import { templateCategories, templateChips } from "@/lib/landing-data";

function logoSrc(logo: string) {
	return logo.startsWith("http") ? logo : `https://cdn.simpleicons.org/${logo}/f5f6f8`;
}

function Chip({ name, logo, category }: { name: string; logo: string; category: string }) {
	return (
		<div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5">
			<span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#0c0e12]">
				{/* biome-ignore lint/performance/noImgElement: remote brand icons, no optimisation needed */}
				<img
					src={logoSrc(logo)}
					alt=""
					width={18}
					height={18}
					loading="lazy"
					className="size-[18px]"
				/>
			</span>
			<span className="text-sm text-foreground">{name}</span>
			<span className="font-mono text-[10px] text-muted-2">{category}</span>
		</div>
	);
}

export function Templates() {
	const half = Math.ceil(templateChips.length / 2);
	const rowA = templateChips.slice(0, half);
	const rowB = templateChips.slice(half);

	return (
		<section id="templates" className="border-y border-border bg-surface/30 py-20 sm:py-28">
			<Container>
				<BlurFade inView>
					<SectionHeading
						align="center"
						eyebrow="Template catalog"
						title="86 one-click deploys. Zero lock-in after."
						lede="Every template becomes a plain compose service you can edit, version and back up like anything else you run. Image tags are checked in CI so nothing points at a dead registry."
					/>
				</BlurFade>
			</Container>

			<div className="mt-12 space-y-4">
				<Marquee duration="90s">
					{rowA.map((t) => (
						<Chip key={t.name} {...t} />
					))}
				</Marquee>
				<Marquee duration="100s" reverse>
					{rowB.map((t) => (
						<Chip key={t.name} {...t} />
					))}
				</Marquee>
			</div>

			<Container>
				<BlurFade inView delay={0.1}>
					<div className="mt-10 flex flex-wrap items-center justify-center gap-2">
						{templateCategories.map((c) => (
							<span
								key={c}
								className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted"
							>
								{c}
							</span>
						))}
					</div>
					<div className="mt-8 text-center">
						<Link
							href="/features#templates"
							className="inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
						>
							Browse the full catalog <ArrowRight className="size-4" />
						</Link>
					</div>
				</BlurFade>
			</Container>
		</section>
	);
}
