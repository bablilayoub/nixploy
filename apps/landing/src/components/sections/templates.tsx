import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/motion-provider";
import { TemplateLogo } from "@/components/template-logo";
import { featuredTemplateIds } from "@/lib/landing-data";
import { findTemplate, templateCount } from "@/lib/templates";

const featured = featuredTemplateIds
	.map(findTemplate)
	.filter((entry) => entry !== undefined)
	.slice(0, 7);
export function Templates() {
	const [lead, ...rest] = featured;
	return (
		<section id="templates" className="container-page py-20 lg:py-28">
			<div className="signal-product-heading">
				<h2>
					Less setup.
					<br />
					<span className="text-muted-foreground">More building.</span>
				</h2>
				<p>
					{templateCount} reviewed Compose stacks, from developer tools to the applications your
					team runs every day.
				</p>
			</div>
			<Reveal className="signal-template-showcase">
				{lead && (
					<Link href={`/templates/${lead.id}`} className="signal-featured-template">
						<TemplateLogo logo={lead.logo} name={lead.name} />
						<span className="mt-10 block text-xs text-primary">Ready to deploy</span>
						<h3 className="mt-3 text-4xl font-medium tracking-tight">{lead.name}</h3>
						<p className="mt-4 text-sm leading-relaxed text-muted-foreground">
							{lead.description.replaceAll("`", "")}
						</p>
						<span className="mt-8 inline-flex min-h-11 items-center gap-2 text-sm">
							Explore the stack
							<ArrowUpRight className="size-4" aria-hidden="true" />
						</span>
					</Link>
				)}
				<div className="grid gap-3 sm:grid-cols-2">
					{rest.map((template) => (
						<Link
							key={template.id}
							href={`/templates/${template.id}`}
							className="signal-template-card flex items-start gap-4"
						>
							<TemplateLogo logo={template.logo} name={template.name} />
							<span className="min-w-0">
								<span className="block text-base font-medium">{template.name}</span>
								<span className="mt-1 block text-xs text-muted-foreground">
									{template.category}
								</span>
								<span className="mt-3 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
									{template.description.replaceAll("`", "")}
								</span>
							</span>
						</Link>
					))}
				</div>
			</Reveal>
			<div className="mt-8 flex justify-end">
				<Link href="/templates" className="signal-text-action">
					Browse all {templateCount} applications
					<ArrowUpRight className="size-4" aria-hidden="true" />
				</Link>
			</div>
		</section>
	);
}
