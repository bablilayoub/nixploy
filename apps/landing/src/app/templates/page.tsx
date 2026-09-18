import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { site } from "@/lib/site";
import { templateCatalog, templateCategories, templateCount } from "@/lib/templates";

export const metadata: Metadata = {
	title: `Self-host ${templateCount} apps on your own server`,
	description: `One-click Docker Compose templates for ${templateCount} self-hosted apps — Supabase, n8n, Ollama, Plausible, Ghost, Vaultwarden and more. Deploy on your own VPS with automatic HTTPS, backups and monitoring.`,
	alternates: { canonical: `${site.url}/templates` },
};

/** simple-icons slug or an absolute URL — the catalog stores both shapes. */
const logoUrl = (logo: string): string =>
	logo.startsWith("http") ? logo : `https://cdn.simpleicons.org/${logo}`;

export default function TemplatesPage() {
	const byCategory = templateCategories.map((category) => ({
		category,
		entries: templateCatalog.filter((template) => template.category === category),
	}));

	return (
		<PageShell
			wide
			eyebrow="Templates"
			title={`Self-host ${templateCount} apps, one click each`}
			description="Every template is a reviewed Docker Compose stack: pinned images, named volumes, sensible variables. Pick one, give it a domain, and Nixploy handles TLS, backups and monitoring."
		>
			<div className="space-y-14">
				{byCategory.map(({ category, entries }) => (
					<section key={category}>
						<h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
							{category}
							<span className="ml-2 text-sm font-normal text-muted">{entries.length}</span>
						</h2>
						<ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{entries.map((template) => (
								<li key={template.id}>
									<Link
										href={`/templates/${template.id}`}
										className="flex h-full gap-3 rounded-xl border border-border bg-surface/40 p-4 transition-colors hover:border-foreground/30 hover:bg-surface"
									>
										{/* biome-ignore lint/performance/noImgElement: remote brand marks from a CDN, no loader configured */}
										<img
											src={logoUrl(template.logo)}
											alt=""
											width={28}
											height={28}
											loading="lazy"
											className="mt-0.5 size-7 shrink-0 rounded"
										/>
										<span className="min-w-0">
											<span className="block text-sm font-medium text-foreground">
												{template.name}
											</span>
											<span className="mt-1 block text-xs leading-relaxed text-muted line-clamp-3">
												{template.description.replaceAll("`", "")}
											</span>
										</span>
									</Link>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</PageShell>
	);
}
