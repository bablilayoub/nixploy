import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame } from "@/components/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { brandIconSrc } from "@/lib/brand";
import { site } from "@/lib/site";
import { templateCatalog, templateCategories, templateCount } from "@/lib/templates";

export const metadata: Metadata = {
	title: `Self-host ${templateCount} apps on your own server`,
	description: `One-click Docker Compose templates for ${templateCount} self-hosted apps — Supabase, n8n, Ollama, Plausible, Ghost, Vaultwarden and more. Deploy on your own VPS with automatic HTTPS, backups and monitoring.`,
	alternates: { canonical: `${site.url}/templates` },
};

/** "Developer Tools" → "developer-tools": the anchor a category chip jumps to. */
const slug = (category: string): string => category.toLowerCase().replaceAll(" ", "-");

export default function TemplatesPage() {
	const byCategory = templateCategories.map((category) => ({
		category,
		id: slug(category),
		entries: templateCatalog.filter((template) => template.category === category),
	}));

	return (
		<PageFrame
			eyebrow="Templates"
			title={`Self-host ${templateCount} apps, one click each`}
			description="Every template is a reviewed Docker Compose stack: pinned images, named volumes, sensible variables. Pick one, give it a domain, and Nixploy handles TLS, backups and monitoring."
			actions={
				<Button asChild size="lg" className="rounded-lg">
					<Link href="/docs/install">Install Nixploy</Link>
				</Button>
			}
		>
			<nav aria-label="Template categories" className="flex flex-wrap gap-2">
				{byCategory.map(({ category, id, entries }) => (
					<Button key={id} asChild variant="outline" size="sm" className="rounded-full">
						<a href={`#${id}`}>
							{category}
							<Badge variant="secondary" className="ml-1">
								{entries.length}
							</Badge>
						</a>
					</Button>
				))}
			</nav>

			{byCategory.map(({ category, id, entries }) => (
				<section key={category} id={id} className="mt-16 scroll-mt-28">
					<h2 className="text-2xl font-semibold tracking-tight">
						{category}
						<span className="ml-3 text-base font-normal text-muted-foreground">
							{entries.length}
						</span>
					</h2>
					<ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{entries.map((template) => (
							<li key={template.id}>
								<Link href={`/templates/${template.id}`} className="block h-full">
									<Card className="h-full gap-0 p-5 transition-colors hover:border-primary/40">
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
											<span className="min-w-0 truncate text-sm font-medium">{template.name}</span>
										</div>
										<p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
											{template.description.replaceAll("`", "")}
										</p>
									</Card>
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}
		</PageFrame>
	);
}
