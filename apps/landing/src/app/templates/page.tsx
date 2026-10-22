import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { TemplateCatalog } from "@/components/template-catalog";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";
import { templateCatalog, templateCategories, templateCount } from "@/lib/templates";

export const metadata: Metadata = {
	title: `Self-host ${templateCount} apps on your own server`,
	description: `One-click Docker Compose templates for ${templateCount} self-hosted apps — Supabase, n8n, Ollama, Plausible, Ghost, Vaultwarden and more. Deploy on your own VPS with automatic HTTPS, backups and monitoring.`,
	alternates: { canonical: `${site.url}/templates` },
};

export default function TemplatesPage() {
	return (
		<PageFrame
			eyebrow="Templates"
			title="Your next stack starts here."
			description={`${templateCount} reviewed applications. Every template is a reviewed Docker Compose stack: pinned images, named volumes, sensible variables. Pick one, give it a domain, and Nixploy handles TLS, backups and monitoring.`}
			actions={
				<Button asChild size="lg" className="rounded-lg">
					<Link href="/docs/install">Install Nixploy</Link>
				</Button>
			}
		>
			<TemplateCatalog
				categories={templateCategories}
				entries={templateCatalog.map(({ id, name, description, logo, category, tags }) => ({
					id,
					name,
					description,
					logo,
					category,
					tags,
				}))}
			/>
		</PageFrame>
	);
}
