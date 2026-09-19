import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { brandIconSrc, ChipRow, Panel, Pill, Tile } from "@/components/ui";
import { site } from "@/lib/site";
import { templateCatalog, templateCategories, templateCount } from "@/lib/templates";

export const metadata: Metadata = {
	title: `Self-host ${templateCount} apps on your own server`,
	description: `One-click Docker Compose templates for ${templateCount} self-hosted apps — Supabase, n8n, Ollama, Plausible, Ghost, Vaultwarden and more. Deploy on your own VPS with automatic HTTPS, backups and monitoring.`,
	alternates: { canonical: `${site.url}/templates` },
};

/** "Developer Tools" → "developer-tools": the anchor a category chip jumps to. */
const slug = (category: string): string => category.toLowerCase().replaceAll(" ", "-");

/*
 * The catalog as one page: the reference's chip row of sections under the
 * header, then a grid of small linked panels per category. Every count on
 * the page is the catalog's own, so a template that stops shipping drops
 * out of its section instead of being advertised.
 */
export default function TemplatesPage() {
	const byCategory = templateCategories.map((category) => ({
		category,
		id: slug(category),
		entries: templateCatalog.filter((template) => template.category === category),
	}));
	const chips = byCategory.map(({ category, id }) => ({ href: `#${id}`, label: category }));

	return (
		<PageShell
			eyebrow="Templates"
			title={`Self-host ${templateCount} apps, one click each`}
			description="Every template is a reviewed Docker Compose stack: pinned images, named volumes, sensible variables. Pick one, give it a domain, and Nixploy handles TLS, backups and monitoring."
			actions={
				<Pill href="/docs/install" arrow>
					Install Nixploy
				</Pill>
			}
		>
			<ChipRow items={chips} label="Template categories" />

			{byCategory.map(({ category, id, entries }) => (
				<section key={category} id={id} className="mt-20 scroll-mt-28">
					<h2 className="text-title text-foreground">
						{category}
						<span className="ml-3 text-body font-normal text-muted-2">{entries.length}</span>
					</h2>
					<ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{entries.map((template) => (
							<li key={template.id}>
								<Panel href={`/templates/${template.id}`} className="h-full">
									<span className="flex items-center gap-3">
										<Tile size={44}>
											{/* biome-ignore lint/performance/noImgElement: remote brand marks from a CDN, no loader configured */}
											<img
												src={brandIconSrc(template.logo)}
												alt=""
												width={22}
												height={22}
												loading="lazy"
												className="size-[22px]"
											/>
										</Tile>
										<span className="min-w-0 truncate text-body font-medium text-foreground">
											{template.name}
										</span>
									</span>
									<span className="mt-3 line-clamp-2 block text-small text-muted">
										{template.description.replaceAll("`", "")}
									</span>
								</Panel>
							</li>
						))}
					</ul>
				</section>
			))}
		</PageShell>
	);
}
