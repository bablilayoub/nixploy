"use client";

import { useState } from "react";

import { Marquee } from "@/components/magicui/marquee";
import { type CatalogTemplate, catalogTemplates, simpleIconUrl } from "@/lib/catalog-templates";

function TemplateChip({ name, logo }: CatalogTemplate) {
	const [failed, setFailed] = useState(false);

	return (
		<figure className="flex w-40 items-center gap-3 rounded-md border border-border bg-surface/80 px-3 py-2.5">
			{failed ? (
				<span className="grid size-7 place-items-center rounded-md border border-border text-[11px] font-semibold uppercase text-muted">
					{name.charAt(0)}
				</span>
			) : (
				<span className="grid size-7 place-items-center rounded-md border border-border bg-background">
					{/* biome-ignore lint/performance/noImgElement: simple-icons CDN */}
					<img
						src={simpleIconUrl(logo)}
						alt=""
						width={14}
						height={14}
						className="size-3.5 opacity-90"
						onError={() => setFailed(true)}
					/>
				</span>
			)}
			<figcaption className="truncate text-sm text-foreground/90">{name}</figcaption>
		</figure>
	);
}

export function Templates() {
	return (
		<section id="templates" className="overflow-hidden border-t border-border py-20 sm:py-28">
			<div className="mx-auto mb-12 max-w-6xl px-5 text-center sm:px-6">
				<p className="font-mono text-xs tracking-[0.18em] text-muted uppercase">Templates</p>
				<h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
					One-click stacks
				</h2>
				<p className="mx-auto mt-3 max-w-md text-muted">
					The same catalog as the dashboard — ready to deploy.
				</p>
			</div>

			<div className="relative">
				<Marquee pauseOnHover className="[--duration:45s]">
					{catalogTemplates.map((t) => (
						<TemplateChip key={t.name} {...t} />
					))}
				</Marquee>
				<div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background" />
				<div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background" />
			</div>
		</section>
	);
}
