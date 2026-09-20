import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Marquee } from "@/components/ui/marquee";
import { brandIconSrc } from "@/lib/brand";
import { featuredTemplateIds } from "@/lib/landing-data";
import { findTemplate, type TemplateEntry, templateCount } from "@/lib/templates";

/*
 * The catalog strip: @magicui/marquee carrying the same card the catalog
 * page uses. Names and categories come from the generated catalog, so it cannot
 * advertise a template we do not ship.
 */
const featured = featuredTemplateIds.map(findTemplate).filter((entry) => entry !== undefined);
const half = Math.ceil(featured.length / 2);
const rows = [featured.slice(0, half), featured.slice(half)];

function TemplateCard({ template }: { template: TemplateEntry }) {
	return (
		<Link href={`/templates/${template.id}`} className="w-[320px] shrink-0">
			<Card className="h-full gap-0 p-5 transition-colors hover:border-foreground/25">
				<div className="flex items-center gap-3">
					<span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent">
						{/* biome-ignore lint/performance/noImgElement: remote brand marks from a CDN, no loader configured */}
						<img
							src={brandIconSrc(template.logo)}
							alt=""
							width={20}
							height={20}
							loading="lazy"
							className="size-5"
						/>
					</span>
					<span className="min-w-0">
						<span className="block truncate text-sm font-medium">{template.name}</span>
						<span className="mt-0.5 block text-xs text-muted-foreground">{template.category}</span>
					</span>
				</div>
				<p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
					{template.description.replaceAll("`", "")}
				</p>
			</Card>
		</Link>
	);
}

export function Templates() {
	return (
		<section id="templates" className="py-20 lg:py-28">
			<div className="container-page flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
				<div className="max-w-2xl">
					<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
						One click
					</p>
					<h2 className="mt-4 text-4xl font-semibold tracking-tight text-balance lg:text-5xl">
						{templateCount} stacks you do not have to write
					</h2>
					<p className="mt-4 text-lg text-muted-foreground">
						Pinned images, named volumes, and only the variables the stack actually needs.
					</p>
				</div>
				<Button asChild variant="outline" size="lg" className="rounded-xl">
					<Link href="/templates">Browse all {templateCount}</Link>
				</Button>
			</div>

			<div className="mt-12 flex flex-col gap-4 [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]">
				{rows.map((row, index) => (
					<Marquee
						key={index === 0 ? "forward" : "reverse"}
						pauseOnHover
						reverse={index === 1}
						className="[--duration:70s] [--gap:1rem]"
					>
						{row.map((template) => (
							<TemplateCard key={template.id} template={template} />
						))}
					</Marquee>
				))}
			</div>
		</section>
	);
}
