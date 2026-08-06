"use client";

import { useState } from "react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Marquee } from "@/components/magicui/marquee";
import { type CatalogTemplate, catalogTemplates, simpleIconUrl } from "@/lib/catalog-templates";
import { cn } from "@/lib/utils";

function TemplateLogo({ name, logo }: CatalogTemplate) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return (
			<span className="grid size-8 place-items-center rounded-full border border-white/10 bg-white/5 text-[11px] font-semibold uppercase">
				{name.charAt(0)}
			</span>
		);
	}
	return (
		<span className="grid size-8 place-items-center rounded-full border border-white/10 bg-white/5">
			{/* biome-ignore lint/performance/noImgElement: simple-icons CDN */}
			<img
				src={simpleIconUrl(logo)}
				alt=""
				width={16}
				height={16}
				className="size-4 opacity-90"
				onError={() => setFailed(true)}
			/>
		</span>
	);
}

function Card({ template }: { template: CatalogTemplate }) {
	return (
		<figure
			className={cn(
				"relative w-44 cursor-default overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-4",
			)}
		>
			<div className="flex items-center gap-3">
				<TemplateLogo {...template} />
				<figcaption className="truncate text-sm font-medium text-neutral-200">
					{template.name}
				</figcaption>
			</div>
		</figure>
	);
}

export function Templates() {
	const mid = Math.ceil(catalogTemplates.length / 2);
	const first = catalogTemplates.slice(0, mid);
	const second = catalogTemplates.slice(mid);

	return (
		<section id="templates" className="overflow-hidden border-t border-white/10 py-24">
			<div className="mx-auto mb-12 max-w-2xl px-5 text-center sm:px-6">
				<BlurFade inView>
					<p className="font-mono text-xs tracking-[0.2em] text-neutral-500 uppercase">Catalog</p>
					<h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
						One-click templates
					</h2>
					<p className="mt-3 text-neutral-400">
						The same catalog as the dashboard — ready to deploy.
					</p>
				</BlurFade>
			</div>

			<div className="relative flex w-full flex-col items-center justify-center overflow-hidden">
				<Marquee pauseOnHover className="[--duration:50s]">
					{first.map((t) => (
						<Card key={t.name} template={t} />
					))}
				</Marquee>
				<Marquee reverse pauseOnHover className="[--duration:50s]">
					{second.map((t) => (
						<Card key={t.name} template={t} />
					))}
				</Marquee>
				<div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-[#050505]" />
				<div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-[#050505]" />
			</div>
		</section>
	);
}
